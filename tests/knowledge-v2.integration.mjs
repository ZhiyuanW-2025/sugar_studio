import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";

const appUrl = process.env.SUGAR_APP_URL ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !key || !secret) throw new Error("Load .env.local before running this integration test.");
const admin = createClient(url, secret, { auth: { persistSession: false } });
const browserClient = () => createClient(url, key, { auth: { persistSession: false } });
const projectRef = new URL(url).hostname.split(".")[0];
const token = randomUUID().slice(0, 8);
const email = `knowledge-v2-${Date.now()}@sugar.invalid`;
const password = `Sugar!${randomUUID()}Z9`;
let userId;
let projectId;
const storagePaths = [];

const dbQuery = (sql) => execFileSync("npx", ["supabase", "db", "query", "--linked", sql], { cwd: process.cwd(), encoding: "utf8" });
const cookie = (session) => `sb-${projectRef}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
async function call(path, cookieValue, init = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}${path}`, { ...init, headers: { ...(init.headers ?? {}), Cookie: cookieValue }, signal: AbortSignal.timeout(180_000) });
      const body = await response.json().catch(() => null);
      if (response.status < 500 || attempt === 2) return { response, body };
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 750));
  }
  throw lastError;
}
async function upload(cookieValue, name, bytes, replacesFileId) {
  const form = new FormData();
  form.set("projectId", projectId);
  form.set("file", new File([bytes], name));
  if (replacesFileId) form.set("replacesFileId", replacesFileId);
  return call("/api/projects/files", cookieValue, { method: "POST", body: form });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}
function textPng() {
  const glyphs = {
    C: ["1111", "1000", "1000", "1000", "1000", "1000", "1111"],
    O: ["1111", "1001", "1001", "1001", "1001", "1001", "1111"],
    D: ["1110", "1001", "1001", "1001", "1001", "1001", "1110"],
    E: ["1111", "1000", "1000", "1110", "1000", "1000", "1111"],
    "7": ["1111", "0001", "0010", "0010", "0100", "0100", "0100"],
    "4": ["1001", "1001", "1001", "1111", "0001", "0001", "0001"],
    "2": ["1111", "0001", "0001", "1111", "1000", "1000", "1111"],
    "1": ["0010", "0110", "0010", "0010", "0010", "0010", "0111"],
    " ": ["0000", "0000", "0000", "0000", "0000", "0000", "0000"],
  };
  const text = "CODE 7421";
  const scale = 10; const margin = 20; const width = margin * 2 + text.length * 5 * scale; const height = margin * 2 + 7 * scale;
  const raw = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y += 1) raw[y * (width * 3 + 1)] = 0;
  [...text].forEach((character, glyphIndex) => {
    glyphs[character].forEach((row, gy) => [...row].forEach((pixel, gx) => {
      if (pixel !== "1") return;
      for (let sy = 0; sy < scale; sy += 1) for (let sx = 0; sx < scale; sx += 1) {
        const x = margin + glyphIndex * 5 * scale + gx * scale + sx;
        const y = margin + gy * scale + sy;
        const offset = y * (width * 3 + 1) + 1 + x * 3;
        raw[offset] = 0; raw[offset + 1] = 0; raw[offset + 2] = 0;
      }
    }));
  });
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

try {
  userId = randomUUID();
  dbQuery(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, phone, phone_change, phone_change_token, email_change_token_current, reauthentication_token) values ('00000000-0000-0000-0000-000000000000'::uuid, '${userId}'::uuid, 'authenticated', 'authenticated', '${email}', crypt('${password}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Knowledge V2"}'::jsonb, now(), now(), '', '', '', '', null, '', '', '', ''); insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values ('${userId}', '${userId}'::uuid, '{"sub":"${userId}","email":"${email}","email_verified":true,"phone_verified":false}'::jsonb, 'email', now(), now(), now());`);
  let auth;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    auth = await browserClient().auth.signInWithPassword({ email, password });
    if (!auth.error || (auth.error.status !== 0 && auth.error.status < 500)) break;
    await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 750));
  }
  assert.ifError(auth.error);
  const userClient = browserClient(); await userClient.auth.setSession({ access_token: auth.data.session.access_token, refresh_token: auth.data.session.refresh_token });
  const project = await userClient.rpc("create_sugar_project", { p_name: `Knowledge V2 ${token}`, p_description: "test" }); assert.ifError(project.error); projectId = project.data.id;
  dbQuery(`do $$ declare source_user_id uuid; source_provider text; source_model text; source_api_key text; begin select user_id, provider, model into source_user_id, source_provider, source_model from public.user_model_configs where user_id <> '${userId}'::uuid order by created_at limit 1; select api_key into source_api_key from public.resolve_user_model_config(source_user_id, 'planning'); perform public.create_user_model_config('${userId}'::uuid, source_provider, source_model, source_api_key, true); end $$;`);
  const authCookie = cookie(auth.data.session);

  const firstBytes = new TextEncoder().encode(`Version one ${token}`);
  const first = await upload(authCookie, `brief-${token}.txt`, firstBytes); assert.equal(first.response.status, 201, JSON.stringify(first.body)); storagePaths.push(first.body.file.storage_path);
  const duplicate = await upload(authCookie, `duplicate-${token}.txt`, firstBytes); assert.equal(duplicate.response.status, 409);
  const firstIndex = await call(`/api/knowledge/documents/${first.body.knowledge.documentId}/index`, authCookie, { method: "POST" }); assert.equal(firstIndex.response.status, 200, JSON.stringify(firstIndex.body));

  const second = await upload(authCookie, `brief-${token}-v2.txt`, new TextEncoder().encode(`Version two ${token} official duration 319 seconds`), first.body.file.id); assert.equal(second.response.status, 201, JSON.stringify(second.body)); storagePaths.push(second.body.file.storage_path); assert.equal(second.body.file.version, 2);
  const secondIndex = await call(`/api/knowledge/documents/${second.body.knowledge.documentId}/index`, authCookie, { method: "POST" }); assert.equal(secondIndex.response.status, 200, JSON.stringify(secondIndex.body));
  const files = await call(`/api/projects/files?projectId=${projectId}`, authCookie); assert.ok(files.body.files.some((file) => file.id === first.body.file.id && file.supersededAt));

  const preview = await call(`/api/knowledge/documents/${second.body.knowledge.documentId}`, authCookie); assert.equal(preview.response.status, 200); assert.match(preview.body.chunks[0].content, /319 seconds/);
  const search = await call("/api/knowledge/search", authCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, query: "official duration 319 seconds", scope: "project" }) }); assert.equal(search.response.status, 200, JSON.stringify(search.body)); assert.ok(search.body.results.length > 0);
  const feedback = await call("/api/knowledge/search", authCookie, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ searchId: search.body.searchId, feedback: "helpful" }) }); assert.equal(feedback.response.status, 200);

  const image = await upload(authCookie, `ocr-${token}.png`, textPng()); assert.equal(image.response.status, 201, JSON.stringify(image.body)); storagePaths.push(image.body.file.storage_path);
  const imageIndex = await call(`/api/knowledge/documents/${image.body.knowledge.documentId}/index`, authCookie, { method: "POST" }); assert.equal(imageIndex.response.status, 200, JSON.stringify(imageIndex.body));
  const imagePreview = await call(`/api/knowledge/documents/${image.body.knowledge.documentId}`, authCookie); assert.match(imagePreview.body.chunks.map((chunk) => chunk.content).join(" "), /CODE/i); assert.match(imagePreview.body.chunks.map((chunk) => chunk.content).join(" "), /7421/);
  console.log("Knowledge duplicate detection, file versions, preview, search feedback, and image OCR passed");
} finally {
  if (storagePaths.length) await admin.storage.from("project-files").remove(storagePaths);
  if (projectId) await admin.from("projects").delete().eq("id", projectId);
  if (userId) {
    dbQuery(`do $$ declare config record; begin for config in select id from public.user_model_configs where user_id = '${userId}'::uuid loop perform public.delete_user_model_config('${userId}'::uuid, config.id); end loop; end $$;`);
    dbQuery(`delete from auth.users where id = '${userId}'::uuid;`);
  }
}
