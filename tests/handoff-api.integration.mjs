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
const threadId = randomUUID();
const requestId = randomUUID();
const token = randomUUID().slice(0, 8);
const emailA = `handoff-api-a-${Date.now()}@sugar.invalid`;
const emailB = `handoff-api-b-${Date.now()}@sugar.invalid`;
const passwordA = `Sugar!${randomUUID()}Z9`;
const passwordB = `Sugar!${randomUUID()}Z9`;
let fixturesCreated = false;

const dbQuery = (sql) => execFileSync("npx", ["supabase", "db", "query", "--linked", sql], {
  cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const client = () => createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const sessionCookie = (session) => `sb-${projectRef}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
const api = async (path, cookie, body, method = "POST") => {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}${path}`, {
        method,
        headers: { ...(method === "POST" ? { "Content-Type": "application/json" } : {}), Cookie: cookie },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(120_000),
      });
      return { response, body: await response.json() };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`Request failed for ${method} ${path}`, { cause: lastError });
};

const retrySafeDelivery = async (path, cookie, body) => {
  try {
    return await api(path, cookie, body);
  } catch {
    return api(path, cookie, body);
  }
};

try {
  dbQuery(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone, phone_change, phone_change_token, email_change_token_current, reauthentication_token
    ) values
      ('00000000-0000-0000-0000-000000000000'::uuid, '${userAId}'::uuid, 'authenticated', 'authenticated', '${emailA}', crypt('${passwordA}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Handoff API A"}'::jsonb, now(), now(), '', '', '', '', null, '', '', '', ''),
      ('00000000-0000-0000-0000-000000000000'::uuid, '${userBId}'::uuid, 'authenticated', 'authenticated', '${emailB}', crypt('${passwordB}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Handoff API B"}'::jsonb, now(), now(), '', '', '', '', null, '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values
      ('${userAId}', '${userAId}'::uuid, '{"sub":"${userAId}","email":"${emailA}","email_verified":true,"phone_verified":false}'::jsonb, 'email', now(), now(), now()),
      ('${userBId}', '${userBId}'::uuid, '{"sub":"${userBId}","email":"${emailB}","email_verified":true,"phone_verified":false}'::jsonb, 'email', now(), now(), now());
    insert into public.projects (id, name, description, status)
    values ('${projectId}'::uuid, 'Handoff API ${token}', '交接测试', 'active');
    insert into public.project_members (project_id, user_id, role)
    values ('${projectId}'::uuid, '${userAId}'::uuid, 'member');
    insert into public.agent_threads (id, project_id, user_id, agent_type, title)
    values ('${threadId}'::uuid, '${projectId}'::uuid, '${userAId}'::uuid, 'planning', '策划师小花');
    insert into public.messages (thread_id, request_id, role, content)
    values
      ('${threadId}'::uuid, '${requestId}'::uuid, 'user', 'Moon Moi 任务需要缩短。'),
      ('${threadId}'::uuid, '${requestId}'::uuid, 'assistant', '将两步观察改为三分钟内完成的单步视觉匹配，其他页面和视觉风格保持不变。');
    do $$
    declare source_user_id uuid; source_provider text; source_model text; source_api_key text;
    begin
      select user_id, provider, model into source_user_id, source_provider, source_model
      from public.user_model_configs where user_id <> '${userAId}'::uuid order by created_at limit 1;
      select api_key into source_api_key from public.resolve_user_model_config(source_user_id, 'planning');
      perform public.create_user_model_config('${userAId}'::uuid, source_provider, source_model, source_api_key, true);
    end $$;
  `);
  fixturesCreated = true;

  const [authA, authB] = await Promise.all([
    client().auth.signInWithPassword({ email: emailA, password: passwordA }),
    client().auth.signInWithPassword({ email: emailB, password: passwordB }),
  ]);
  assert.ifError(authA.error);
  assert.ifError(authB.error);
  const cookieA = sessionCookie(authA.data.session);
  const cookieB = sessionCookie(authB.data.session);

  const forbidden = await api("/api/handoffs/draft", cookieB, { projectId, targetAgent: "coding" });
  assert.equal(forbidden.response.status, 403);

  const draft = await api("/api/handoffs/draft", cookieA, { projectId, targetAgent: "coding" });
  assert.equal(draft.response.status, 201);
  assert.ok(draft.body.taskId && draft.body.title && draft.body.content && draft.body.brief);
  assert.equal(draft.body.briefType, "technical");
  assert.ok(Array.isArray(draft.body.brief.requirements));
  assert.ok(Array.isArray(draft.body.brief.unchanged_scope));
  assert.ok(Array.isArray(draft.body.brief.acceptance_criteria));
  assert.equal(draft.body.brief.related_project, `Handoff API ${token}`);
  assert.doesNotMatch(JSON.stringify(draft.body), /sk-[A-Za-z0-9_-]+/);

  const before = dbQuery(`
    select json_build_object(
      'status', (select status from public.handoff_tasks where id = '${draft.body.taskId}'::uuid),
      'target_messages', (select count(*) from public.messages as m join public.agent_threads as t on t.id = m.thread_id
        where t.project_id = '${projectId}'::uuid and t.agent_type = 'coding')
    ) as handoff_before;
  `);
  assert.match(before, /draft/);
  assert.match(before, /target_messages/);
  assert.match(before, /0/);

  const editedTitle = `确认后的牛牛任务 ${token}`;
  const editedBrief = {
    ...draft.body.brief,
    title: editedTitle,
    unchanged_scope: [...draft.body.brief.unchanged_scope, `其他页面不得修改 ${token}`],
    acceptance_criteria: [...draft.body.brief.acceptance_criteria, `必须保留 ${token}`],
  };
  const delivered = await retrySafeDelivery(`/api/handoffs/${draft.body.taskId}/deliver`, cookieA, {
    projectId, brief: editedBrief,
  });
  assert.equal(delivered.response.status, 200);
  assert.equal(delivered.body.delivered, true);
  assert.equal(delivered.body.task.briefType, "technical");
  assert.equal(delivered.body.task.brief.title, editedTitle);
  assert.ok(delivered.body.task.brief.unchanged_scope.includes(`其他页面不得修改 ${token}`));
  assert.doesNotMatch(JSON.stringify(delivered.body), /sk-[A-Za-z0-9_-]+/);

  const codingHistory = await api(`/api/agents/coding/messages?projectId=${projectId}`, cookieA, null, "GET");
  assert.equal(codingHistory.response.status, 200);
  assert.equal(codingHistory.body.messages.length, 1);
  assert.equal(codingHistory.body.messages[0].role, "system");
  assert.match(codingHistory.body.messages[0].content, new RegExp(token));
  assert.match(codingHistory.body.messages[0].content, /Technical Brief/);
  assert.match(codingHistory.body.messages[0].content, /unchanged_scope/);

  const result = dbQuery(`
    select json_build_object(
      'task', (select json_build_object('status', status, 'approved', approved_at is not null, 'delivered', delivered_at is not null)
        from public.handoff_tasks where id = '${draft.body.taskId}'::uuid),
      'events', (select json_agg(event_type order by created_at) from public.project_activities
        where related_entity_id = '${draft.body.taskId}'::uuid)
    ) as handoff_result;
  `);
  assert.match(result, /delivered/);
  assert.match(result, /handoff_task_created/);
  assert.match(result, /handoff_task_approved/);
  assert.match(result, /handoff_task_delivered/);

  const visualDraft = await api("/api/handoffs/draft", cookieA, { projectId, targetAgent: "design" });
  assert.equal(visualDraft.response.status, 201);
  assert.equal(visualDraft.body.briefType, "visual");
  assert.ok(Array.isArray(visualDraft.body.brief.content_requirements));
  assert.ok(Array.isArray(visualDraft.body.brief.visual_direction));
  assert.ok(Array.isArray(visualDraft.body.brief.required_elements));
  assert.ok(Array.isArray(visualDraft.body.brief.forbidden_elements));
  assert.ok(Array.isArray(visualDraft.body.brief.references));
  assert.equal(typeof visualDraft.body.brief.size_or_medium, "string");

  const editedVisualBrief = {
    ...visualDraft.body.brief,
    forbidden_elements: [...visualDraft.body.brief.forbidden_elements, `不得改变玩法 ${token}`],
  };
  const visualDelivered = await api(`/api/handoffs/${visualDraft.body.taskId}/deliver`, cookieA, {
    projectId,
    brief: editedVisualBrief,
  });
  assert.equal(visualDelivered.response.status, 200);
  assert.equal(visualDelivered.body.task.briefType, "visual");

  const designHistory = await api(`/api/agents/design/messages?projectId=${projectId}`, cookieA, null, "GET");
  assert.equal(designHistory.response.status, 200);
  assert.equal(designHistory.body.messages.length, 1);
  assert.match(designHistory.body.messages[0].content, /Visual Brief/);
  assert.match(designHistory.body.messages[0].content, /forbidden_elements/);
  assert.match(designHistory.body.messages[0].content, new RegExp(`不得改变玩法 ${token}`));

  console.log("structured Technical/Visual Brief drafts, user edit/approval, delivery, target threads, Activity, and API-key secrecy passed");
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
