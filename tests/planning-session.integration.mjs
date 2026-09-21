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
const projectOneId = randomUUID();
const projectTwoId = randomUUID();
const emailA = `session-live-a-${Date.now()}@sugar.invalid`;
const emailB = `session-live-b-${Date.now()}@sugar.invalid`;
const passwordA = `Sugar!${randomUUID()}Z9`;
const passwordB = `Sugar!${randomUUID()}Z9`;
const firstRequestId = randomUUID();
const secondRequestId = randomUUID();
const failedRequestId = randomUUID();
const memoryCode = `银杏-${randomUUID().slice(0, 8)}`;
const invalidModel = `invalid-session-test-${randomUUID().slice(0, 8)}`;
let fixturesCreated = false;

const dbQuery = (sql) =>
  execFileSync("npx", ["supabase", "db", "query", "--linked", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const createAuthClient = () =>
  createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const sessionCookie = (session) => {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  return `sb-${projectRef}-auth-token=${value}`;
};

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const withTransportRetry = async (operation, attempts = 3) => {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await wait(attempt * 750);
    }
  }

  throw lastError;
};

const signInWithRetry = async (client, credentials) => {
  let lastResult;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    lastResult = await client.auth.signInWithPassword(credentials);
    if (!lastResult.error || lastResult.error.status !== 0) return lastResult;
    if (attempt < 3) await wait(attempt * 750);
  }

  return lastResult;
};

const callApi = async (cookie, path, options = {}) => {
  return withTransportRetry(async () => {
    const response = await fetch(`${appUrl}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
        Cookie: cookie,
      },
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.json();
    return { response, body };
  });
};

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
      '{"display_name":"Session Live Test A"}'::jsonb,
      now(), now(), '', '', '', '', null, '', '', '', ''
    ),
    (
      '00000000-0000-0000-0000-000000000000'::uuid,
      '${userBId}'::uuid, 'authenticated', 'authenticated', '${emailB}',
      crypt('${passwordB}', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Session Live Test B"}'::jsonb,
      now(), now(), '', '', '', '', null, '', '', '', ''
    );

    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at,
      created_at, updated_at
    ) values
    (
      '${userAId}', '${userAId}'::uuid,
      '{"sub":"${userAId}","email":"${emailA}","email_verified":true,"phone_verified":false}'::jsonb,
      'email', now(), now(), now()
    ),
    (
      '${userBId}', '${userBId}'::uuid,
      '{"sub":"${userBId}","email":"${emailB}","email_verified":true,"phone_verified":false}'::jsonb,
      'email', now(), now(), now()
    );

    insert into public.projects (id, name)
    values
      ('${projectOneId}'::uuid, 'Live Session Project One'),
      ('${projectTwoId}'::uuid, 'Live Session Project Two');

    insert into public.project_members (project_id, user_id, role)
    values
      ('${projectOneId}'::uuid, '${userAId}'::uuid, 'member'),
      ('${projectTwoId}'::uuid, '${userAId}'::uuid, 'member'),
      ('${projectOneId}'::uuid, '${userBId}'::uuid, 'member');

    do $$
    declare
      source_user_id uuid;
      source_provider text;
      source_model text;
      source_api_key text;
    begin
      select user_id, provider, model
      into source_user_id, source_provider, source_model
      from public.user_model_configs
      where user_id <> '${userAId}'::uuid
      order by created_at
      limit 1;

      select api_key
      into source_api_key
      from public.resolve_user_model_config(source_user_id, 'planning');

      perform public.create_user_model_config(
        '${userAId}'::uuid,
        source_provider,
        source_model,
        source_api_key,
        true
      );
    end;
    $$;
  `);
  fixturesCreated = true;

  const copiedConfigCount = dbQuery(`
    select count(*) as copied_config_count
    from public.user_model_configs
    where user_id = '${userAId}'::uuid;
  `);
  assert.match(copiedConfigCount, /copied_config_count[^0-9]*1/i);

  const clientA = createAuthClient();
  const clientB = createAuthClient();
  const [{ data: authA, error: authAError }, { data: authB, error: authBError }] = await Promise.all([
    signInWithRetry(clientA, { email: emailA, password: passwordA }),
    signInWithRetry(clientB, { email: emailB, password: passwordB }),
  ]);
  assert.ifError(authAError);
  assert.ifError(authBError);
  assert.ok(authA.session && authB.session);
  const cookieA = sessionCookie(authA.session);
  const cookieB = sessionCookie(authB.session);

  const first = await callApi(cookieA, "/api/agents/planning/messages", {
    method: "POST",
    body: JSON.stringify({
      projectId: projectOneId,
      requestId: firstRequestId,
      message: `请记住：这次测试的活动代号是「${memoryCode}」，Moon Moi 采用单步视觉匹配。只需简短确认。`,
    }),
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.replayed, false);
  console.log("live session: first turn passed");

  const second = await callApi(cookieA, "/api/agents/planning/messages", {
    method: "POST",
    body: JSON.stringify({
      projectId: projectOneId,
      requestId: secondRequestId,
      message: "刚才的活动代号是什么？Moon Moi 采用什么机制？请同时回答。",
    }),
  });
  assert.equal(second.response.status, 200);
  assert.match(second.body.reply, new RegExp(memoryCode));
  assert.match(second.body.reply, /视觉匹配/);
  console.log("live session: second-turn memory passed");

  const refreshed = await callApi(
    cookieA,
    `/api/agents/planning/messages?projectId=${projectOneId}`,
  );
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.body.messages.length, 4);
  assert.equal(refreshed.body.messages[0].role, "user");
  assert.equal(refreshed.body.messages[3].role, "assistant");
  console.log("live session: refresh history passed");

  const retry = await callApi(cookieA, "/api/agents/planning/messages", {
    method: "POST",
    body: JSON.stringify({
      projectId: projectOneId,
      requestId: secondRequestId,
      message: "A retried transport body must not create another turn.",
    }),
  });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.body.replayed, true);
  console.log("live session: retry idempotency passed");

  const projectTwo = await callApi(
    cookieA,
    `/api/agents/planning/messages?projectId=${projectTwoId}`,
  );
  assert.equal(projectTwo.response.status, 200);
  assert.deepEqual(projectTwo.body.messages, []);
  console.log("live session: project isolation passed");

  const userBView = await callApi(
    cookieB,
    `/api/agents/planning/messages?projectId=${projectOneId}`,
  );
  assert.equal(userBView.response.status, 200);
  assert.deepEqual(userBView.body.messages, []);
  console.log("live session: user isolation passed");

  dbQuery(`
    select public.create_user_model_config(
      '${userAId}'::uuid,
      'openai',
      '${invalidModel}',
      (select api_key from public.resolve_user_model_config('${userAId}'::uuid, 'planning')),
      false
    );

    insert into public.agent_model_preferences (user_id, agent_type, model_config_id)
    select '${userAId}'::uuid, 'planning', id
    from public.user_model_configs
    where user_id = '${userAId}'::uuid
      and model = '${invalidModel}';
  `);

  const afterModelSwitch = await callApi(
    cookieA,
    `/api/agents/planning/messages?projectId=${projectOneId}`,
  );
  assert.equal(afterModelSwitch.response.status, 200);
  assert.equal(afterModelSwitch.body.messages.length, 4);
  console.log("live session: model-switch history passed");

  const failedRun = await callApi(cookieA, "/api/agents/planning/messages", {
    method: "POST",
    body: JSON.stringify({
      projectId: projectOneId,
      requestId: failedRequestId,
      message: "This turn must not be persisted when the selected model fails.",
    }),
  });
  assert.equal(failedRun.response.status, 502);
  console.log("live session: failed model response passed");

  const afterFailure = await callApi(
    cookieA,
    `/api/agents/planning/messages?projectId=${projectOneId}`,
  );
  assert.equal(afterFailure.response.status, 200);
  assert.equal(afterFailure.body.messages.length, 4);

  console.log("live two-turn memory, refresh, retry, project/user isolation, model switch, and failure rollback passed");
} finally {
  if (fixturesCreated) {
    dbQuery(`
      do $$
      declare
        config record;
      begin
        for config in
          select id
          from public.user_model_configs
          where user_id = '${userAId}'::uuid
        loop
          perform public.delete_user_model_config('${userAId}'::uuid, config.id);
        end loop;
      end;
      $$;

      delete from auth.users where id in ('${userAId}'::uuid, '${userBId}'::uuid);
      delete from public.projects where id in ('${projectOneId}'::uuid, '${projectTwoId}'::uuid);
    `);
  }
}
