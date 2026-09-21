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
const emailA = `specialists-a-${Date.now()}@sugar.invalid`;
const emailB = `specialists-b-${Date.now()}@sugar.invalid`;
const passwordA = `Sugar!${randomUUID()}Z9`;
const passwordB = `Sugar!${randomUUID()}Z9`;
let fixturesCreated = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dbQuery = (sql) =>
  execFileSync("npx", ["supabase", "db", "query", "--linked", sql], {
    cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
const authClient = () => createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const cookie = (session) => `sb-${projectRef}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;

const call = async (agentType, sessionCookie, body, method = "POST") => {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const suffix = method === "GET" ? `?projectId=${body.projectId}` : "";
      const response = await fetch(`${appUrl}/api/agents/${agentType}/messages${suffix}`, {
        method,
        headers: { ...(method === "POST" ? { "Content-Type": "application/json" } : {}), Cookie: sessionCookie },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(120_000),
      });
      return { response, body: await response.json() };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 750);
    }
  }
  throw lastError;
};

const debugAgent = async (agentType, sessionCookie, message) => {
  const response = await fetch(`${appUrl}/api/agents/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({ agentType, projectId, message }),
    signal: AbortSignal.timeout(120_000),
  });
  return { response, body: await response.json() };
};

try {
  dbQuery(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone, phone_change, phone_change_token, email_change_token_current, reauthentication_token
    ) values
      ('00000000-0000-0000-0000-000000000000'::uuid, '${userAId}'::uuid, 'authenticated', 'authenticated', '${emailA}', crypt('${passwordA}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Specialist A"}'::jsonb, now(), now(), '', '', '', '', null, '', '', '', ''),
      ('00000000-0000-0000-0000-000000000000'::uuid, '${userBId}'::uuid, 'authenticated', 'authenticated', '${emailB}', crypt('${passwordB}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Specialist B"}'::jsonb, now(), now(), '', '', '', '', null, '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values
      ('${userAId}', '${userAId}'::uuid, '{"sub":"${userAId}","email":"${emailA}","email_verified":true,"phone_verified":false}'::jsonb, 'email', now(), now(), now()),
      ('${userBId}', '${userBId}'::uuid, '{"sub":"${userBId}","email":"${emailB}","email_verified":true,"phone_verified":false}'::jsonb, 'email', now(), now(), now());
    insert into public.projects (id, name, description, status)
    values ('${projectId}'::uuid, 'Specialist Project ${token}', '专项 Agent 集成测试', 'specialist-${token}');
    insert into public.project_snapshots (project_id, summary, current_plan_summary, current_stage)
    values ('${projectId}'::uuid, '正式摘要 ${token}', '正式方案 ${token}', '实现验证 ${token}');
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

  const codingFirst = await call("coding", cookieA, {
    projectId, requestId: randomUUID(),
    message: `请记住本轮技术代号是 NIU-${token}，只回复你已记住。`,
  });
  assert.equal(codingFirst.response.status, 200);
  assert.equal(codingFirst.body.prompt.source, "database");
  assert.ok(codingFirst.body.model?.model);

  const codingSecond = await call("coding", cookieA, {
    projectId, requestId: randomUUID(), message: "我上一轮给的技术代号是什么？",
  });
  assert.equal(codingSecond.response.status, 200);
  assert.match(codingSecond.body.reply, new RegExp(`NIU-${token}`, "i"));

  const designContext = await call("design", cookieA, {
    projectId, requestId: randomUUID(),
    message: "请读取正式项目数据，并告诉我当前项目状态和当前阶段。",
  });
  assert.equal(designContext.response.status, 200);
  assert.deepEqual(designContext.body.toolCalls, ["get_project_context"]);
  assert.match(designContext.body.reply, new RegExp(`specialist-${token}`));
  assert.match(designContext.body.reply, new RegExp(`实现验证 ${token}`));
  assert.equal(designContext.body.prompt.source, "database");

  const [codingHistory, designHistory] = await Promise.all([
    call("coding", cookieA, { projectId }, "GET"),
    call("design", cookieA, { projectId }, "GET"),
  ]);
  assert.equal(codingHistory.response.status, 200);
  assert.equal(designHistory.response.status, 200);
  assert.equal(codingHistory.body.messages.length, 4);
  assert.equal(designHistory.body.messages.length, 2);
  assert.ok(codingHistory.body.messages.every((item) => !item.content.includes("实现验证")));

  const forbidden = await call("coding", cookieB, { projectId }, "GET");
  assert.equal(forbidden.response.status, 403);

  const incomplete = await debugAgent("coding", cookieA, "帮我把这个玩法做出来。");
  assert.equal(incomplete.response.status, 200);
  assert.match(incomplete.body.reply, /缺少|需要|提供|明确|确认/);
  assert.doesNotMatch(incomplete.body.reply, /已经修改|已完成开发|代码已完成/);
  assert.equal(incomplete.body.agent.name, "工程师牛牛");
  assert.equal(incomplete.body.project.id, projectId);
  assert.equal(incomplete.body.prompt.source, "database");
  assert.ok(incomplete.body.prompt.version >= 2);
  assert.ok(incomplete.body.model.model);
  assert.ok(incomplete.body.durationMs > 0);
  assert.equal(incomplete.body.traceId, undefined);

  const unchanged = await debugAgent("coding", cookieA, "只修改 Moon Moi 页面，其他页面不要动。");
  assert.equal(unchanged.response.status, 200);
  assert.match(unchanged.body.reply, /其他页面|不修改|不得修改|保持不变|硬边界/);

  const expanded = await debugAgent("coding", cookieA, "顺便把整个项目 UI 都重新设计一下。");
  assert.equal(expanded.response.status, 200);
  assert.match(expanded.body.reply, /新增范围|扩大|超出|单独确认|重新确认/);

  const vagueVisual = await debugAgent("design", cookieA, "做一张视觉图，好看一点。");
  assert.equal(vagueVisual.response.status, 200);
  assert.match(vagueVisual.body.reply, /用途|使用场景/);
  assert.match(vagueVisual.body.reply, /尺寸|媒介/);
  assert.equal(vagueVisual.body.agent.name, "艺术家小熊");
  assert.match(vagueVisual.body.traceId, /^trace_/);

  const boundedVisual = await debugAgent("design", cookieA, "按照这个视觉 Brief 做，但不要改变活动玩法。");
  assert.equal(boundedVisual.response.status, 200);
  assert.match(boundedVisual.body.reply, /玩法|机制|策划/);
  assert.match(boundedVisual.body.reply, /视觉/);
  assert.match(boundedVisual.body.reply, /(?:不.{0,12}|保留.{0,12})玩法/);

  const forbiddenDebug = await debugAgent("coding", cookieB, "测试越权");
  assert.equal(forbiddenDebug.response.status, 403);

  console.log("Direct Codex Niuniu and Agents SDK Xiaoxiong prompts, boundaries, memory, refresh, and isolation passed");
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
