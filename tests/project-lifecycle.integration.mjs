import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !publishableKey || !secretKey) throw new Error("Load .env.local before running this integration test.");

const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const authClient = () => createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const token = randomUUID().slice(0, 8);
const emailA = `project-a-${Date.now()}@sugar.invalid`;
const emailB = `project-b-${Date.now()}@sugar.invalid`;
const emailC = `project-c-${Date.now()}@sugar.invalid`;
const password = `Sugar!${randomUUID()}Z9`;
const createdUserIds = [];
const createdProjectIds = [];

async function createUser(email, displayName) {
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
    if (!result.error || result.error.status !== 504) break;
    await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 750));
  }
  const { data, error } = result;
  assert.ifError(error);
  createdUserIds.push(data.user.id);
  const client = authClient();
  const auth = await client.auth.signInWithPassword({ email, password });
  assert.ifError(auth.error);
  return { client, user: data.user };
}

try {
  const a = await createUser(emailA, "Project Test A");
  const b = await createUser(emailB, "Project Test B");
  const c = await createUser(emailC, "Project Test C");

  const first = await a.client.rpc("create_sugar_project", { p_name: `真实项目一 ${token}`, p_description: "第一项目" });
  assert.ifError(first.error);
  const second = await a.client.rpc("create_sugar_project", { p_name: `真实项目二 ${token}`, p_description: "第二项目" });
  assert.ifError(second.error);
  createdProjectIds.push(first.data.id, second.data.id);

  const { data: aProjects, error: aProjectsError } = await a.client.from("projects").select("id, name, status").in("id", createdProjectIds);
  assert.ifError(aProjectsError);
  assert.equal(aProjects.length, 2);
  const { data: strangerProjects, error: strangerError } = await c.client.from("projects").select("id").in("id", createdProjectIds);
  assert.ifError(strangerError);
  assert.equal(strangerProjects.length, 0);

  const added = await a.client.rpc("add_project_member_by_email", { p_project_id: first.data.id, p_email: emailB, p_role: "member" });
  assert.ifError(added.error);
  const bUpdate = await b.client.from("projects").update({ description: "成员可更新" }).eq("id", first.data.id).select("id").single();
  assert.ifError(bUpdate.error);

  const threadA = await a.client.from("agent_threads").insert({ project_id: first.data.id, user_id: a.user.id, agent_type: "planning", title: "A" }).select("id").single();
  const threadB = await b.client.from("agent_threads").insert({ project_id: first.data.id, user_id: b.user.id, agent_type: "planning", title: "B" }).select("id").single();
  assert.ifError(threadA.error);
  assert.ifError(threadB.error);
  const { data: visibleToA } = await a.client.from("agent_threads").select("id").eq("project_id", first.data.id);
  assert.deepEqual(visibleToA.map((row) => row.id), [threadA.data.id]);
  const { data: projectTwoThreads } = await a.client.from("agent_threads").select("id").eq("project_id", second.data.id);
  assert.equal(projectTwoThreads.length, 0);

  const membership = await a.client.from("project_members").select("id").eq("project_id", first.data.id).eq("user_id", b.user.id).single();
  assert.ifError(membership.error);
  assert.ifError((await a.client.rpc("update_project_member_role", { p_project_id: first.data.id, p_membership_id: membership.data.id, p_role: "project_lead" })).error);
  assert.ifError((await a.client.rpc("update_project_member_role", { p_project_id: first.data.id, p_membership_id: membership.data.id, p_role: "member" })).error);

  assert.ifError((await a.client.from("projects").update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", first.data.id)).error);
  const archived = await a.client.from("projects").select("status").eq("id", first.data.id).single();
  assert.equal(archived.data.status, "archived");

  assert.ifError((await a.client.rpc("remove_project_member", { p_project_id: first.data.id, p_membership_id: membership.data.id })).error);
  const { data: bAfterRemoval } = await b.client.from("projects").select("id").eq("id", first.data.id);
  assert.equal(bAfterRemoval.length, 0);
  const forbiddenAdd = await c.client.rpc("add_project_member_by_email", { p_project_id: first.data.id, p_email: emailC, p_role: "member" });
  assert.ok(forbiddenAdd.error);

  console.log("Project create/list, member parity, isolation, archive, and removal passed");
} finally {
  if (createdProjectIds.length) await admin.from("projects").delete().in("id", createdProjectIds);
  for (const userId of createdUserIds) await admin.auth.admin.deleteUser(userId);
}
