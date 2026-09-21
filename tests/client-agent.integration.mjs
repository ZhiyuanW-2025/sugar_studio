import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const appUrl = process.env.SUGAR_APP_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !publishableKey || !process.env.SUPABASE_SECRET_KEY) {
  throw new Error("Load the configured .env.local before running this integration test.");
}

const userAId = randomUUID();
const userBId = randomUUID();
const projectId = randomUUID();
const token = randomUUID().slice(0, 8);
const emailA = `client-a-${Date.now()}@sugar.invalid`;
const emailB = `client-b-${Date.now()}@sugar.invalid`;
const passwordA = `Sugar!${randomUUID()}Z9`;
const passwordB = `Sugar!${randomUUID()}Z9`;
let fixturesCreated = false;

const dbQuery = (sql) =>
  execFileSync("npx", ["supabase", "db", "query", "--linked", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const authClient = () => createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const cookie = (session) =>
  `sb-${projectRef}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;

async function call(method, sessionCookie, body) {
  const suffix = method === "GET" ? `?projectId=${encodeURIComponent(body.projectId)}` : "";
  const response = await fetch(`${appUrl}/api/agents/client/messages${suffix}`, {
    method,
    headers: {
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      Cookie: sessionCookie,
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(120_000),
  });
  return { response, body: await response.json() };
}

try {
  dbQuery(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone, phone_change, phone_change_token, email_change_token_current, reauthentication_token
    ) values
      ('00000000-0000-0000-0000-000000000000'::uuid, '${userAId}'::uuid, 'authenticated', 'authenticated', '${emailA}', crypt('${passwordA}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Client A"}'::jsonb, now(), now(), '', '', '', '', null, '', '', '', ''),
      ('00000000-0000-0000-0000-000000000000'::uuid, '${userBId}'::uuid, 'authenticated', 'authenticated', '${emailB}', crypt('${passwordB}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Client B"}'::jsonb, now(), now(), '', '', '', '', null, '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values
      ('${userAId}', '${userAId}'::uuid, '{"sub":"${userAId}","email":"${emailA}","email_verified":true,"phone_verified":false}'::jsonb, 'email', now(), now(), now()),
      ('${userBId}', '${userBId}'::uuid, '{"sub":"${userBId}","email":"${emailB}","email_verified":true,"phone_verified":false}'::jsonb, 'email', now(), now(), now());
    insert into public.projects (id, name, description, status)
    values ('${projectId}'::uuid, 'Client Project ${token}', 'B 端客户交付测试', 'client-${token}');
    insert into public.project_snapshots (project_id, summary, current_plan_summary, current_stage)
    values ('${projectId}'::uuid, '客户可见摘要 ${token}', '正式方案 ${token}', '客户确认 ${token}');
    insert into public.project_members (project_id, user_id, role)
    values ('${projectId}'::uuid, '${userAId}'::uuid, 'member');
    do $$
    declare
      source_user_id uuid;
      source_provider text;
      source_model text;
      source_api_key text;
    begin
      select user_id, provider, model into source_user_id, source_provider, source_model
      from public.user_model_configs where user_id <> '${userAId}'::uuid order by created_at limit 1;
      select api_key into source_api_key from public.resolve_user_model_config(source_user_id, 'planning');
      perform public.create_user_model_config('${userAId}'::uuid, source_provider, source_model, source_api_key, true);
    end;
    $$;
  `);
  fixturesCreated = true;

  const [authA, authB] = await Promise.all([
    authClient().auth.signInWithPassword({ email: emailA, password: passwordA }),
    authClient().auth.signInWithPassword({ email: emailB, password: passwordB }),
  ]);
  assert.ifError(authA.error);
  assert.ifError(authB.error);
  const cookieA = cookie(authA.data.session);
  const cookieB = cookie(authB.data.session);

  const first = await call("POST", cookieA, {
    projectId,
    requestId: randomUUID(),
    message: "请读取当前项目的正式状态和阶段，起草一段给客户项目负责人的进度汇报。明确标记为内部草稿。",
  });
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.body.toolCalls, ["get_project_context"]);
  assert.equal(first.body.prompt.source, "database");
  assert.equal(first.body.model.provider, "openai");
  assert.match(first.body.reply, new RegExp(`client-${token}|客户确认 ${token}`, "i"));
  assert.match(first.body.reply, /草稿|待确认/);

  const second = await call("POST", cookieA, {
    projectId,
    requestId: randomUUID(),
    message: "沿用刚才的项目，把正文压缩成三点，不要新增价格或交期承诺。",
  });
  assert.equal(second.response.status, 200);

  const history = await call("GET", cookieA, { projectId });
  assert.equal(history.response.status, 200);
  assert.equal(history.body.messages.length, 4);

  const forbidden = await call("GET", cookieB, { projectId });
  assert.equal(forbidden.response.status, 403);

  console.log("Xiaoxue context tool, real reply, session persistence, and project isolation passed");
} finally {
  if (fixturesCreated) {
    dbQuery(`
      do $$ declare config record; begin
        for config in select id from public.user_model_configs where user_id = '${userAId}'::uuid loop
          perform public.delete_user_model_config('${userAId}'::uuid, config.id);
        end loop;
      end $$;
      delete from auth.users where id in ('${userAId}'::uuid, '${userBId}'::uuid);
      delete from public.projects where id = '${projectId}'::uuid;
    `);
  }
}
