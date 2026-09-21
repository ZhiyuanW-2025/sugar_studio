import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const appUrl = process.env.SUGAR_APP_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error("Load the configured .env.local before running this integration test.");
}

const userAId = randomUUID();
const userBId = randomUUID();
const projectId = randomUUID();
const emailA = `files-a-${Date.now()}@sugar.invalid`;
const emailB = `files-b-${Date.now()}@sugar.invalid`;
const passwordA = `Sugar!${randomUUID()}Z9`;
const passwordB = `Sugar!${randomUUID()}Z9`;
let fixturesCreated = false;
let uploadedStoragePath = null;

const dbQuery = (sql) =>
  execFileSync("npx", ["supabase", "db", "query", "--linked", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const client = () =>
  createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const admin = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const sessionCookie = (session) =>
  `sb-${projectRef}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;

const api = (path, cookie, init = {}) =>
  fetch(`${appUrl}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Cookie: cookie },
    signal: AbortSignal.timeout(30_000),
  });

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (response.status < 500 || attempt === 2) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
  }
  throw lastError;
}

try {
  dbQuery(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change, phone, phone_change,
      phone_change_token, email_change_token_current, reauthentication_token
    ) values
    (
      '00000000-0000-0000-0000-000000000000'::uuid,
      '${userAId}'::uuid, 'authenticated', 'authenticated', '${emailA}',
      crypt('${passwordA}', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"File Test A"}'::jsonb,
      now(), now(), '', '', '', '', null, '', '', '', ''
    ),
    (
      '00000000-0000-0000-0000-000000000000'::uuid,
      '${userBId}'::uuid, 'authenticated', 'authenticated', '${emailB}',
      crypt('${passwordB}', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"File Test B"}'::jsonb,
      now(), now(), '', '', '', '', null, '', '', '', ''
    );

    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at,
      created_at, updated_at
    ) values
      ('${userAId}', '${userAId}'::uuid,
       '{"sub":"${userAId}","email":"${emailA}","email_verified":true,"phone_verified":false}'::jsonb,
       'email', now(), now(), now()),
      ('${userBId}', '${userBId}'::uuid,
       '{"sub":"${userBId}","email":"${emailB}","email_verified":true,"phone_verified":false}'::jsonb,
       'email', now(), now(), now());

    insert into public.projects (id, name)
    values ('${projectId}'::uuid, 'Project Files Integration');

    insert into public.project_members (project_id, user_id, role)
    values ('${projectId}'::uuid, '${userAId}'::uuid, 'member');
  `);
  fixturesCreated = true;

  const [authA, authB] = await Promise.all([
    client().auth.signInWithPassword({ email: emailA, password: passwordA }),
    client().auth.signInWithPassword({ email: emailB, password: passwordB }),
  ]);
  assert.ifError(authA.error);
  assert.ifError(authB.error);
  assert.ok(authA.data.session && authB.data.session);
  const cookieA = sessionCookie(authA.data.session);
  const cookieB = sessionCookie(authB.data.session);

  // Keep this fixture above Vinext's historical 1 MB multipart default so the
  // integration test catches regressions before real PDFs reach the route.
  const pdfFixture = Buffer.alloc(1_700_000, 0x20);
  pdfFixture.write("%PDF-1.4\n", 0, "utf8");
  const form = new FormData();
  form.set("projectId", projectId);
  form.set("file", new File([pdfFixture], "project-note.pdf", { type: "application/pdf" }));
  const upload = await api("/api/projects/files", cookieA, { method: "POST", body: form });
  assert.equal(upload.status, 201);
  const uploadBody = await upload.json();
  assert.equal(uploadBody.uploaded, true);
  assert.ok(uploadBody.file?.id);
  uploadedStoragePath = uploadBody.file.storage_path;

  const list = await api(`/api/projects/files?projectId=${projectId}`, cookieA);
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.files.length, 1);
  assert.equal(listBody.files[0].fileName, "project-note.pdf");
  assert.equal(listBody.files[0].uploaderName, "File Test A");

  const open = await api(
    `/api/projects/files/${uploadBody.file.id}?projectId=${projectId}`,
    cookieA,
    { redirect: "manual" },
  );
  assert.equal(open.status, 302);
  const signedUrl = open.headers.get("location");
  assert.ok(signedUrl);
  const download = await fetchWithRetry(signedUrl);
  assert.equal(download.status, 200);
  const downloadedPdf = Buffer.from(await download.arrayBuffer());
  assert.equal(downloadedPdf.length, pdfFixture.length);
  assert.equal(downloadedPdf.subarray(0, 8).toString("utf8"), "%PDF-1.4");

  const forbiddenList = await api(`/api/projects/files?projectId=${projectId}`, cookieB);
  assert.equal(forbiddenList.status, 403);
  const forbiddenDelete = await api(
    `/api/projects/files/${uploadBody.file.id}?projectId=${projectId}`,
    cookieB,
    { method: "DELETE" },
  );
  assert.equal(forbiddenDelete.status, 403);

  const remove = await api(
    `/api/projects/files/${uploadBody.file.id}?projectId=${projectId}`,
    cookieA,
    { method: "DELETE" },
  );
  assert.equal(remove.status, 200);
  assert.equal((await remove.json()).deleted, true);

  const afterDelete = await api(`/api/projects/files?projectId=${projectId}`, cookieA);
  assert.deepEqual((await afterDelete.json()).files, []);

  const activityResult = dbQuery(`
    select event_type from public.project_activities
    where project_id = '${projectId}'::uuid
    order by created_at;
  `);
  assert.match(activityResult, /project_file_uploaded/);
  assert.match(activityResult, /project_file_deleted/);

  console.log("large PDF upload, list, signed download, delete, activity, and member isolation passed");
} finally {
  if (uploadedStoragePath) {
    await admin.storage.from("project-files").remove([uploadedStoragePath]);
  }
  if (fixturesCreated) {
    dbQuery(`
      delete from auth.users where id in ('${userAId}'::uuid, '${userBId}'::uuid);
      delete from public.projects where id = '${projectId}'::uuid;
    `);
  }
}
