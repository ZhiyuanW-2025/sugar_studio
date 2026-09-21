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
const projectAId = randomUUID();
const projectBId = randomUUID();
const token = randomUUID().slice(0, 8);
const emailA = `project-context-a-${Date.now()}@sugar.invalid`;
const emailB = `project-context-b-${Date.now()}@sugar.invalid`;
const passwordA = `Sugar!${randomUUID()}Z9`;
const passwordB = `Sugar!${randomUUID()}Z9`;
const projectAStatus = `context_status_${token}`;
const projectAStage = `制作验证-${token}`;
const projectAReward = `终点奖励是柠檬徽章-${token}`;
const projectBStatus = `other_status_${token}`;
const projectBStage = `B 阶段-${token}`;
const projectBSummary = `B 项目的私有摘要-${token}`;
let fixturesCreated = false;

const syncWait = (milliseconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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
      if (attempt < 3) syncWait(attempt * 750);
    }
  }

  throw lastError;
};

const createAuthClient = () =>
  createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const signInWithRetry = async (client, credentials) => {
  let lastResult;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    lastResult = await client.auth.signInWithPassword(credentials);
    if (!lastResult.error || lastResult.error.status !== 0) return lastResult;
    if (attempt < 3) await wait(attempt * 750);
  }

  return lastResult;
};

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const sessionCookie = (session) => {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  return `sb-${projectRef}-auth-token=${value}`;
};

const callApi = async (cookie, body) => {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}/api/agents/planning/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      return { response, body: await response.json() };
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
    ) values
    (
      '00000000-0000-0000-0000-000000000000'::uuid,
      '${userAId}'::uuid, 'authenticated', 'authenticated', '${emailA}',
      crypt('${passwordA}', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Project Context Test A"}'::jsonb,
      now(), now(), '', '', '', '', null, '', '', '', ''
    ),
    (
      '00000000-0000-0000-0000-000000000000'::uuid,
      '${userBId}'::uuid, 'authenticated', 'authenticated', '${emailB}',
      crypt('${passwordB}', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Project Context Test B"}'::jsonb,
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

    insert into public.projects (id, name, description, status)
    values
      ('${projectAId}'::uuid, 'Context Project A ${token}', 'A 项目描述', '${projectAStatus}'),
      ('${projectBId}'::uuid, 'Context Project B ${token}', 'B 项目描述', '${projectBStatus}');

    insert into public.project_snapshots (
      project_id, summary, current_plan_summary, current_stage
    ) values
      ('${projectAId}'::uuid, '${projectAReward}', 'A 项目的当前方案-${token}', '${projectAStage}'),
      ('${projectBId}'::uuid, '${projectBSummary}', 'B 项目的当前方案-${token}', '${projectBStage}');

    insert into public.project_members (project_id, user_id, role)
    values
      ('${projectAId}'::uuid, '${userAId}'::uuid, 'member'),
      ('${projectBId}'::uuid, '${userAId}'::uuid, 'member');

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

  const clientA = createAuthClient();
  const clientB = createAuthClient();
  const [{ data: authA, error: authAError }, { data: authB, error: authBError }] =
    await Promise.all([
      signInWithRetry(clientA, { email: emailA, password: passwordA }),
      signInWithRetry(clientB, { email: emailB, password: passwordB }),
    ]);
  assert.ifError(authAError);
  assert.ifError(authBError);
  assert.ok(authA.session && authB.session);
  const cookieA = sessionCookie(authA.session);
  const cookieB = sessionCookie(authB.session);

  const factual = await callApi(cookieA, {
    projectId: projectAId,
    requestId: randomUUID(),
    message: "请告诉我当前项目的正式状态、当前阶段和终点奖励。请根据正式项目数据回答。",
  });
  assert.equal(factual.response.status, 200);
  assert.ok(factual.body.toolCalls.includes("get_project_context"));
  assert.match(factual.body.reply, new RegExp(projectAStatus));
  assert.match(factual.body.reply, new RegExp(projectAStage));
  assert.match(factual.body.reply, /柠檬徽章/);
  assert.match(factual.body.reply, new RegExp(token));
  assert.equal(factual.body.prompt.source, "database");
  console.log("project context: factual question called the tool and used official data");

  const factualB = await callApi(cookieA, {
    projectId: projectBId,
    requestId: randomUUID(),
    message: "请告诉我当前项目的正式状态、当前阶段和正式摘要。请根据正式项目数据回答。",
  });
  assert.equal(factualB.response.status, 200);
  assert.ok(factualB.body.toolCalls.includes("get_project_context"));
  assert.match(factualB.body.reply, new RegExp(projectBStatus));
  assert.match(factualB.body.reply, new RegExp(projectBStage));
  assert.match(factualB.body.reply, new RegExp(projectBSummary));
  assert.doesNotMatch(factualB.body.reply, new RegExp(projectAStatus));
  assert.equal(factualB.body.prompt.source, "database");
  assert.equal(factualB.body.prompt.version, factual.body.prompt.version);
  console.log("global prompt: both projects used the same active planning prompt while context stayed project-specific");

  const generic = await callApi(cookieA, {
    projectId: projectBId,
    requestId: randomUUID(),
    message: "这是通用问题：城市游戏的线索怎样控制难度？请给三个通用原则，不要查询具体项目材料。",
  });
  assert.equal(generic.response.status, 200);
  assert.deepEqual(generic.body.toolCalls, []);
  console.log("project context: generic question did not force a tool call");

  const unauthorized = await callApi(cookieB, {
    projectId: projectAId,
    requestId: randomUUID(),
    message: "请读取当前项目状态。",
  });
  assert.equal(unauthorized.response.status, 403);
  assert.equal(unauthorized.body.toolCalls, undefined);
  console.log("project context: non-member access was denied");

  const boundProject = await callApi(cookieA, {
    projectId: projectAId,
    toolProjectId: projectBId,
    requestId: randomUUID(),
    message: "请调用 get_project_context，并且只回答工具实际返回的 project_id。",
  });
  assert.equal(boundProject.response.status, 200);
  assert.ok(boundProject.body.toolCalls.includes("get_project_context"));
  assert.match(boundProject.body.reply, new RegExp(projectAId, "i"));
  assert.doesNotMatch(boundProject.body.reply, new RegExp(projectBId, "i"));
  console.log("project context: tool stayed bound to the request project");

  console.log("planning project context tool, authorization, binding, and trace-visible execution passed");
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
      delete from public.projects where id in ('${projectAId}'::uuid, '${projectBId}'::uuid);
    `);
  }
}
