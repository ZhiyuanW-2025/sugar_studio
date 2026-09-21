import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const appUrl = process.env.SUGAR_APP_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !publishableKey) {
  throw new Error("Load .env.local before running this integration test.");
}

const userId = randomUUID();
const email = `planning-api-${Date.now()}@sugar.invalid`;
const password = `Sugar!${randomUUID()}Z9`;
const requestId = randomUUID();
let fixtureCreated = false;

const dbQuery = (sql) => {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return execFileSync("npx", ["supabase", "db", "query", "--linked", sql], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 750);
      }
    }
  }

  throw lastError;
};

const queryOutput = dbQuery("select id from public.projects order by created_at limit 1;");
const projectId = queryOutput.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
assert.ok(projectId, "The linked database must contain a project fixture.");

const supabase = createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const signInWithRetry = async (credentials) => {
  let lastResult;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    lastResult = await supabase.auth.signInWithPassword(credentials);
    if (!lastResult.error || lastResult.error.status !== 0) return lastResult;
    if (attempt < 3) await wait(attempt * 750);
  }

  return lastResult;
};

const fetchWithTransportRetry = async (url, options) => {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(attempt * 750);
    }
  }

  throw lastError;
};

try {
  dbQuery(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change, phone, phone_change,
      phone_change_token, email_change_token_current, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000'::uuid,
      '${userId}'::uuid,
      'authenticated',
      'authenticated',
      '${email}',
      crypt('${password}', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Planning API Test"}'::jsonb,
      now(), now(), '', '', '', '', null, '', '', '', ''
    );
    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at,
      created_at, updated_at
    ) values (
      '${userId}',
      '${userId}'::uuid,
      '{"sub":"${userId}","email":"${email}","email_verified":true,"phone_verified":false}'::jsonb,
      'email', now(), now(), now()
    );
  `);
  fixtureCreated = true;

  const { data, error } = await signInWithRetry({ email, password });
  assert.ifError(error);
  assert.ok(data.session, "Password sign-in must return a session.");

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const sessionCookie = `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64url")}`;
  const cookie = `sb-${projectRef}-auth-token=${sessionCookie}`;
  const callPlanningApi = () =>
    fetchWithTransportRetry(`${appUrl}/api/agents/planning/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ projectId, requestId, message: "请优化这个活动任务。" }),
    });

  const nonMemberResponse = await callPlanningApi();
  const nonMemberBody = await nonMemberResponse.json();
  assert.equal(nonMemberResponse.status, 403);
  assert.equal(nonMemberBody.error, "你不是该项目成员，无法使用策划 Agent。");

  dbQuery(`
    insert into public.project_members (project_id, user_id, role)
    values ('${projectId}'::uuid, '${userId}'::uuid, 'member');
  `);

  const noConfigResponse = await callPlanningApi();
  const noConfigBody = await noConfigResponse.json();
  assert.ok(
    noConfigResponse.status === 409 || noConfigResponse.status === 503,
    `Expected missing model config (409) or missing server secret (503), got ${noConfigResponse.status}`,
  );
  assert.ok(
    noConfigBody.error === "请先在设置中完成模型配置。" ||
      noConfigBody.error === "模型服务尚未完成服务端配置。",
  );

  const serializedResponses = JSON.stringify([nonMemberBody, noConfigBody]);
  assert.equal(serializedResponses.includes("apiKey"), false);
  assert.equal(serializedResponses.includes("sk-"), false);

  console.log("planning API authentication, membership, missing-config guard, and secret response boundary passed");
} finally {
  if (fixtureCreated) {
    dbQuery(`delete from auth.users where id = '${userId}'::uuid;`);
  }
}
