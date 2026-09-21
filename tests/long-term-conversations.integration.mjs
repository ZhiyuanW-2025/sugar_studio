import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const appUrl = process.env.SUGAR_APP_URL ?? "http://localhost:3000"; const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Load .env.local before running this integration test.");
const ref = new URL(url).hostname.split(".")[0]; const dbQuery = (sql) => execFileSync("npx", ["supabase", "db", "query", "--linked", sql], { cwd: process.cwd(), encoding: "utf8" });
const client = () => createClient(url, key, { auth: { persistSession: false } }); const cookie = (session) => `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
const password = `Sugar!${randomUUID()}Z9`; const userA = randomUUID(); const userB = randomUUID(); const emailA = `conversation-a-${Date.now()}@sugar.invalid`; const emailB = `conversation-b-${Date.now()}@sugar.invalid`; let projects = [];
async function api(path, authCookie, init = {}) { const response = await fetch(`${appUrl}${path}`, { ...init, headers: { ...(init.headers ?? {}), Cookie: authCookie } }); return { response, body: await response.json().catch(() => null) }; }

try {
  dbQuery(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,phone,phone_change,phone_change_token,email_change_token_current,reauthentication_token) values
  ('00000000-0000-0000-0000-000000000000','${userA}','authenticated','authenticated','${emailA}',crypt('${password}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','',null,'','','',''),
  ('00000000-0000-0000-0000-000000000000','${userB}','authenticated','authenticated','${emailB}',crypt('${password}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','',null,'','','','');
  insert into auth.identities(provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values ('${userA}','${userA}','{"sub":"${userA}","email":"${emailA}"}','email',now(),now(),now()),('${userB}','${userB}','{"sub":"${userB}","email":"${emailB}"}','email',now(),now(),now());`);
  const [authA, authB] = await Promise.all([client().auth.signInWithPassword({ email: emailA, password }), client().auth.signInWithPassword({ email: emailB, password })]); assert.ifError(authA.error); assert.ifError(authB.error);
  const a = client(); await a.auth.setSession({ access_token: authA.data.session.access_token, refresh_token: authA.data.session.refresh_token });
  const firstProject = await a.rpc("create_sugar_project", { p_name: "Conversation One", p_description: "one" }); const secondProject = await a.rpc("create_sugar_project", { p_name: "Conversation Two", p_description: "two" }); assert.ifError(firstProject.error); assert.ifError(secondProject.error); projects = [firstProject.data.id, secondProject.data.id];
  const thread = await a.from("agent_threads").insert({ project_id: projects[0], user_id: userA, agent_type: "planning", title: "策划师小花" }).select("id").single(); assert.ifError(thread.error);
  const initial = await a.from("agent_conversations").select("id").eq("thread_id", thread.data.id).eq("is_current", true).single(); assert.ifError(initial.error);
  assert.ifError((await a.rpc("append_agent_turn", { p_thread_id: thread.data.id, p_conversation_id: initial.data.id, p_request_id: randomUUID(), p_user_content: "第一会话暗号：银杏7421", p_assistant_content: "我记住银杏7421。" })).error);
  const newConversation = await api("/api/agent-conversations", cookie(authA.data.session), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: projects[0], agentType: "planning", title: "第二套方案" }) }); assert.equal(newConversation.response.status, 201, JSON.stringify(newConversation.body));
  const secondId = newConversation.body.conversation.id;
  assert.ifError((await a.rpc("append_agent_turn", { p_thread_id: thread.data.id, p_conversation_id: secondId, p_request_id: randomUUID(), p_user_content: "第二会话暗号：海棠319", p_assistant_content: "我记住海棠319。" })).error);
  const firstHistory = await api(`/api/agents/planning/messages?projectId=${projects[0]}&conversationId=${initial.data.id}`, cookie(authA.data.session)); const secondHistory = await api(`/api/agents/planning/messages?projectId=${projects[0]}&conversationId=${secondId}`, cookie(authA.data.session));
  assert.match(JSON.stringify(firstHistory.body), /银杏7421/); assert.doesNotMatch(JSON.stringify(firstHistory.body), /海棠319/); assert.match(JSON.stringify(secondHistory.body), /海棠319/);
  const search = await api(`/api/agent-conversations/search?projectId=${projects[0]}&agentType=planning&q=${encodeURIComponent("银杏7421")}`, cookie(authA.data.session)); assert.equal(search.response.status, 200); assert.equal(search.body.results[0].conversationId, initial.data.id);
  const outsider = await api(`/api/agent-conversations?projectId=${projects[0]}&agentType=planning`, cookie(authB.data.session)); assert.equal(outsider.response.status, 403);
  assert.ifError((await a.from("agent_conversations").update({ summary: "更早对话摘要：银杏暗号已确认", summarized_message_count: 2 }).eq("id", initial.data.id)).error);
  const archived = await api(`/api/agent-conversations/${secondId}`, cookie(authA.data.session), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive" }) }); assert.equal(archived.response.status, 200);
  const list = await api(`/api/agent-conversations?projectId=${projects[0]}&agentType=planning`, cookie(authA.data.session)); assert.ok(list.body.conversations.find((item) => item.id === initial.data.id).isCurrent);
  const otherProject = await a.from("agent_threads").insert({ project_id: projects[1], user_id: userA, agent_type: "planning", title: "另一个项目" }).select("id").single(); assert.ifError(otherProject.error); const otherAgent = await a.from("agent_threads").insert({ project_id: projects[0], user_id: userA, agent_type: "design", title: "艺术家小熊" }).select("id").single(); assert.ifError(otherAgent.error);
  assert.notEqual(otherProject.data.id, thread.data.id); assert.notEqual(otherAgent.data.id, thread.data.id);
  console.log("Multiple conversations, switching, archive fallback, search, summary storage, project/Agent separation, and RLS passed");
} finally {
  if (projects.length) dbQuery(`delete from public.projects where id in (${projects.map((id) => `'${id}'::uuid`).join(",")});`);
  dbQuery(`delete from auth.users where id in ('${userA}'::uuid,'${userB}'::uuid);`);
}
