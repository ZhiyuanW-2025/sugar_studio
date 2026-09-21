import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const appUrl = process.env.SUGAR_APP_URL ?? "http://localhost:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !publishableKey || !secretKey) throw new Error("Load .env.local before running this integration test.");

const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });
const publicClient = () => createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } });
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const password = `Sugar!${randomUUID()}Z9`;
const memberEmail = `feishu-member-${Date.now()}@sugar.invalid`;
const outsiderEmail = `feishu-outsider-${Date.now()}@sugar.invalid`;
let memberId;
let outsiderId;
let projectId;
let mappingId;
let connectionId;
let scopeId;
let outsiderProjectId;

const cookie = (session) => `sb-${projectRef}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
const dbQuery = (sql) => execFileSync("npx", ["supabase", "db", "query", "--linked", sql], { cwd: process.cwd(), stdio: "ignore" });
async function call(path, sessionCookie, init = {}) {
  const response = await fetch(`${appUrl}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(sessionCookie ? { Cookie: sessionCookie } : {}) },
  });
  return { response, body: await response.json().catch(() => null) };
}

try {
  const [member, outsider] = await Promise.all([
    admin.auth.admin.createUser({ email: memberEmail, password, email_confirm: true, user_metadata: { display_name: "Feishu Member" } }),
    admin.auth.admin.createUser({ email: outsiderEmail, password, email_confirm: true, user_metadata: { display_name: "Feishu Outsider" } }),
  ]);
  assert.ifError(member.error); assert.ifError(outsider.error);
  memberId = member.data.user.id; outsiderId = outsider.data.user.id;
  const [memberAuth, outsiderAuth] = await Promise.all([
    publicClient().auth.signInWithPassword({ email: memberEmail, password }),
    publicClient().auth.signInWithPassword({ email: outsiderEmail, password }),
  ]);
  assert.ifError(memberAuth.error); assert.ifError(outsiderAuth.error);
  const memberClient = publicClient();
  await memberClient.auth.setSession({ access_token: memberAuth.data.session.access_token, refresh_token: memberAuth.data.session.refresh_token });
  const project = await memberClient.rpc("create_sugar_project", { p_name: `Feishu Test ${Date.now()}`, p_description: "test" });
  assert.ifError(project.error); projectId = project.data.id;
  const connection = await admin.from("feishu_connections").insert({
    name: "Feishu Test Connection",
    tenant_url: `https://test-${Date.now()}.feishu.cn`,
    status: "active",
    created_by: memberId,
  }).select("id").single();
  assert.ifError(connection.error); connectionId = connection.data.id;
  const scope = await admin.from("feishu_sync_scopes").insert({
    connection_id: connectionId,
    scope_type: "project",
    project_id: projectId,
    space_id: "test-space",
    root_node_token: `test-root-${randomUUID()}`,
    source_url: `https://test-${Date.now()}.feishu.cn/wiki/test`,
    display_name: "Test project knowledge",
    created_by: memberId,
  }).select("id").single();
  assert.ifError(scope.error); scopeId = scope.data.id;
  const mapping = await admin.from("feishu_knowledge_documents").insert({
    sync_scope_id: scopeId,
    scope_type: "project",
    project_id: projectId,
    space_id: "test-space",
    node_token: `test-node-${randomUUID()}`,
    obj_token: `test-object-${randomUUID()}`,
    obj_type: "docx",
    title: "Test Feishu Document",
    sync_status: "pending",
  }).select("id").single();
  assert.ifError(mapping.error); mappingId = mapping.data.id;

  const memberCookie = cookie(memberAuth.data.session);
  const outsiderCookie = cookie(outsiderAuth.data.session);

  assert.equal((await call("/api/knowledge/feishu/status", null)).response.status, 401);
  const outsiderStatus = await call("/api/knowledge/feishu/status", outsiderCookie);
  assert.equal(outsiderStatus.response.status, 403, JSON.stringify(outsiderStatus.body));
  const memberStatus = await call("/api/knowledge/feishu/status", memberCookie);
  assert.equal(memberStatus.response.status, 200, JSON.stringify(memberStatus.body));
  assert.equal(typeof memberStatus.body.configuration.configured, "boolean");
  assert.equal("appSecret" in memberStatus.body.configuration, false);

  const outsiderScopes = await call(`/api/knowledge/feishu/scopes?projectId=${projectId}`, outsiderCookie);
  assert.equal(outsiderScopes.response.status, 403, JSON.stringify(outsiderScopes.body));
  const memberScopes = await call(`/api/knowledge/feishu/scopes?projectId=${projectId}`, memberCookie);
  assert.equal(memberScopes.response.status, 200, JSON.stringify(memberScopes.body));
  assert.ok(memberScopes.body.scopes.some((item) => item.id === scopeId));
  const unknownSync = await call("/api/knowledge/feishu/sync", memberCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scopeId: randomUUID() }),
  });
  assert.equal(unknownSync.response.status, 403, JSON.stringify(unknownSync.body));

  const readableScope = await memberClient.from("feishu_sync_scopes").select("id").eq("id", scopeId).maybeSingle();
  assert.ifError(readableScope.error); assert.equal(readableScope.data.id, scopeId);
  const forbiddenScopeWrite = await memberClient.from("feishu_sync_scopes").insert({
    connection_id: connectionId,
    scope_type: "company",
    space_id: "forbidden",
    source_url: "https://forbidden.feishu.cn/wiki/test",
    display_name: "forbidden",
  });
  assert.ok(forbiddenScopeWrite.error, "authenticated clients must not write sync scopes directly");

  const readable = await memberClient.from("feishu_knowledge_documents").select("id").eq("id", mappingId).maybeSingle();
  assert.ifError(readable.error); assert.equal(readable.data.id, mappingId);
  const forbiddenWrite = await memberClient.from("feishu_knowledge_documents").insert({
    space_id: "forbidden",
    node_token: "forbidden",
    obj_token: "forbidden",
    obj_type: "docx",
    title: "forbidden",
  });
  assert.ok(forbiddenWrite.error, "authenticated clients must not write connector tables directly");

  const outsiderClient = publicClient();
  await outsiderClient.auth.setSession({ access_token: outsiderAuth.data.session.access_token, refresh_token: outsiderAuth.data.session.refresh_token });
  const outsiderProject = await outsiderClient.rpc("create_sugar_project", { p_name: `Feishu Other Project ${Date.now()}`, p_description: "cross-project RLS test" });
  assert.ifError(outsiderProject.error); outsiderProjectId = outsiderProject.data.id;
  const crossProjectMapping = await outsiderClient.from("feishu_knowledge_documents").select("id").eq("id", mappingId).maybeSingle();
  assert.ifError(crossProjectMapping.error); assert.equal(crossProjectMapping.data, null, "a member of another project must not read project Feishu mappings");
  const internalEvents = await outsiderClient.from("feishu_sync_events").select("id").limit(1);
  assert.ok(internalEvents.error, "raw Feishu sync events must remain server-only");
  console.log("Feishu connector auth boundary, workspace RLS, metadata response, and server-only write boundary passed");
} finally {
  if (mappingId) await admin.from("feishu_knowledge_documents").delete().eq("id", mappingId);
  if (connectionId) await admin.from("feishu_connections").delete().eq("id", connectionId);
  if (projectId) dbQuery(`delete from public.projects where id = '${projectId}'::uuid;`);
  if (outsiderProjectId) dbQuery(`delete from public.projects where id = '${outsiderProjectId}'::uuid;`);
  if (memberId) await admin.auth.admin.deleteUser(memberId);
  if (outsiderId) await admin.auth.admin.deleteUser(outsiderId);
}
