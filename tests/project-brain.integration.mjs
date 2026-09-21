import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !key || !secret) throw new Error("Load .env.local before running this integration test.");
const admin = createClient(url, secret, { auth: { persistSession: false } });
const client = () => createClient(url, key, { auth: { persistSession: false } });
const password = `Sugar!${randomUUID()}Z9`;
const userIds = [];
let projectId;

async function user(label) {
  const email = `brain-${label}-${Date.now()}@sugar.invalid`;
  let created;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Brain ${label}` } });
    if (!created.error || created.error.status !== 504) break;
  }
  assert.ifError(created.error);
  userIds.push(created.data.user.id);
  const ownClient = client();
  const auth = await ownClient.auth.signInWithPassword({ email, password });
  assert.ifError(auth.error);
  return { client: ownClient, email, id: created.data.user.id };
}

try {
  const owner = await user("owner");
  const member = await user("member");
  const stranger = await user("stranger");
  const created = await owner.client.rpc("create_sugar_project", { p_name: "Project Brain Test", p_description: "brain" });
  assert.ifError(created.error);
  projectId = created.data.id;
  assert.ifError((await owner.client.rpc("add_project_member_by_email", { p_project_id: projectId, p_email: member.email, p_role: "member" })).error);

  const thread = await owner.client.from("agent_threads").insert({ project_id: projectId, user_id: owner.id, agent_type: "planning", title: "Brain source" }).select("id").single();
  assert.ifError(thread.error);
  const v1 = await owner.client.rpc("save_current_plan", { p_project_id: projectId, p_source_thread_id: thread.data.id, p_content: "正式方案第一版", p_change_summary: "首次确认" });
  const v2 = await owner.client.rpc("save_current_plan", { p_project_id: projectId, p_source_thread_id: thread.data.id, p_content: "正式方案第二版", p_change_summary: "增加第二版内容" });
  assert.ifError(v1.error);
  assert.ifError(v2.error);
  assert.equal(v2.data[0].version, 2);

  const rollback = await member.client.rpc("rollback_current_plan", { p_project_id: projectId, p_target_version_id: v1.data[0].version_id });
  assert.ifError(rollback.error);
  assert.equal(rollback.data[0].version, 3);
  assert.equal(rollback.data[0].current_plan_summary, "正式方案第一版");
  const snapshot = await owner.client.from("project_snapshots").select("current_plan_summary, current_plan_version_id").eq("project_id", projectId).single();
  assert.equal(snapshot.data.current_plan_summary, "正式方案第一版");
  assert.equal(snapshot.data.current_plan_version_id, rollback.data[0].version_id);

  const context = await member.client.rpc("update_project_brain_context", { p_project_id: projectId, p_summary: "成员确认的正式概况", p_current_stage: "制作中" });
  assert.ifError(context.error);
  assert.equal(context.data.current_stage, "制作中");
  assert.ok((await stranger.client.rpc("update_project_brain_context", { p_project_id: projectId, p_summary: "越权", p_current_stage: "越权" })).error);
  const hidden = await stranger.client.from("artifact_versions").select("id").eq("artifact_id", v1.data[0].artifact_id);
  assert.equal(hidden.data.length, 0);

  console.log("Project brain current context, immutable versions, rollback, and RLS passed");
} finally {
  if (projectId) await admin.from("projects").delete().eq("id", projectId);
  for (const userId of userIds) await admin.auth.admin.deleteUser(userId);
}
