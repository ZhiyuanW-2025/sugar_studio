import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const appUrl = process.env.SUGAR_APP_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const repositoryPath = "/Users/wuzhiyuan/Downloads/sscd-miniprogram";
if (!supabaseUrl || !publishableKey || !process.env.SUPABASE_SECRET_KEY) {
  throw new Error("Load .env.local before running this integration test.");
}

const userId = randomUUID();
const outsiderId = randomUUID();
const projectId = randomUUID();
const email = `codex-discussion-${Date.now()}@sugar.invalid`;
const outsiderEmail = `codex-outsider-${Date.now()}@sugar.invalid`;
const password = `Sugar!${randomUUID()}Z9`;
const outsiderPassword = `Sugar!${randomUUID()}Z9`;
const memoryCode = `NIU-${randomUUID().slice(0, 8)}`;
let fixturesCreated = false;

const dbQuery = (sql) => execFileSync("npx", ["supabase", "db", "query", "--linked", sql], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const git = (args) => execFileSync("git", ["-C", repositoryPath, ...args], { encoding: "utf8" });
const authClient = () => createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const cookie = (session) => `sb-${projectRef}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
const call = async (sessionCookie, body, method = "POST") => {
  const suffix = method === "GET" ? `?projectId=${body.projectId}` : "";
  const response = await fetch(`${appUrl}/api/agents/coding/messages${suffix}`, {
    method,
    headers: { ...(method === "POST" ? { "Content-Type": "application/json" } : {}), Cookie: sessionCookie },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(180_000),
  });
  return { response, body: await response.json() };
};

try {
  const branch = git(["branch", "--show-current"]).trim();
  const beforeStatus = git(["status", "--porcelain=v1"]);
  dbQuery(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone, phone_change, phone_change_token, email_change_token_current, reauthentication_token
    ) values
      ('00000000-0000-0000-0000-000000000000'::uuid, '${userId}'::uuid, 'authenticated', 'authenticated', '${email}', crypt('${password}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Codex Discussion Test"}'::jsonb, now(), now(), '', '', '', '', null, '', '', '', ''),
      ('00000000-0000-0000-0000-000000000000'::uuid, '${outsiderId}'::uuid, 'authenticated', 'authenticated', '${outsiderEmail}', crypt('${outsiderPassword}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Codex Outsider"}'::jsonb, now(), now(), '', '', '', '', null, '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values
      ('${userId}', '${userId}'::uuid, '{"sub":"${userId}","email":"${email}","email_verified":true,"phone_verified":false}'::jsonb, 'email', now(), now(), now()),
      ('${outsiderId}', '${outsiderId}'::uuid, '{"sub":"${outsiderId}","email":"${outsiderEmail}","email_verified":true,"phone_verified":false}'::jsonb, 'email', now(), now(), now());
    insert into public.projects (id, name) values ('${projectId}'::uuid, 'Codex Discussion Test');
    insert into public.project_members (project_id, user_id, role) values ('${projectId}'::uuid, '${userId}'::uuid, 'member');
    insert into public.project_repositories (
      project_id, provider, local_repository_path, remote_name, current_branch, default_branch, created_by
    ) values (
      '${projectId}'::uuid, 'local_git', '${repositoryPath}', 'origin', '${branch}', '${branch}', '${userId}'::uuid
    );
    do $$
    declare source_user_id uuid; source_provider text; source_model text; source_api_key text;
    begin
      select user_id, provider, model into source_user_id, source_provider, source_model
      from public.user_model_configs where user_id <> '${userId}'::uuid order by created_at limit 1;
      select api_key into source_api_key from public.resolve_user_model_config(source_user_id, 'coding');
      perform public.create_user_model_config('${userId}'::uuid, source_provider, source_model, source_api_key, true);
    end;
    $$;
  `);
  fixturesCreated = true;

  const [signedIn, outsider] = await Promise.all([
    authClient().auth.signInWithPassword({ email, password }),
    authClient().auth.signInWithPassword({ email: outsiderEmail, password: outsiderPassword }),
  ]);
  assert.ifError(signedIn.error);
  assert.ifError(outsider.error);
  const sessionCookie = cookie(signedIn.data.session);

  const first = await call(sessionCookie, {
    projectId,
    requestId: randomUUID(),
    message: `当前只讨论，不要修改文件。请读取 package.json，告诉我项目 name，并记住代号 ${memoryCode}。`,
  });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.match(first.body.reply, /miniprogram-ts-quickstart/i);
  assert.equal(git(["status", "--porcelain=v1"]), beforeStatus);

  const second = await call(sessionCookie, {
    projectId,
    requestId: randomUUID(),
    message: "刚才的代号是什么？仍然只讨论，不要修改文件。",
  });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.match(second.body.reply, new RegExp(memoryCode, "i"));
  assert.equal(git(["status", "--porcelain=v1"]), beforeStatus);

  const persisted = dbQuery(`
    select conversation.codex_thread_id
    from public.agent_conversations conversation
    join public.agent_threads thread on thread.id = conversation.thread_id
    where thread.user_id='${userId}'::uuid
      and thread.project_id='${projectId}'::uuid
      and thread.agent_type='coding'
      and conversation.is_current;
  `);
  assert.match(persisted, /[0-9a-f]{8}-[0-9a-f-]{20,}/i);

  const history = await call(sessionCookie, { projectId }, "GET");
  assert.equal(history.response.status, 200);
  assert.equal(history.body.messages.length, 4);

  const forbidden = await call(cookie(outsider.data.session), { projectId }, "GET");
  assert.equal(forbidden.response.status, 403);
  console.log("Codex direct read-only discussion, thread resume, persistence, history, and isolation passed");
} finally {
  if (fixturesCreated) {
    dbQuery(`
      do $$ declare config record; begin
        for config in select id from public.user_model_configs where user_id = '${userId}'::uuid loop
          perform public.delete_user_model_config('${userId}'::uuid, config.id);
        end loop;
      end $$;
      delete from auth.users where id in ('${userId}'::uuid, '${outsiderId}'::uuid);
      delete from public.projects where id = '${projectId}'::uuid;
    `);
  }
}
