import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const appUrl = process.env.SUGAR_APP_URL ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Load .env.local before running this integration test.");
const projectRef = new URL(url).hostname.split(".")[0];
const dbQuery = (sql) => execFileSync("npx", ["supabase", "db", "query", "--linked", sql], { cwd: process.cwd(), encoding: "utf8" });
const browserClient = () => createClient(url, key, { auth: { persistSession: false } });
const authCookie = (session) => `sb-${projectRef}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
const token = randomUUID().slice(0, 8);
const password = `Sugar!${randomUUID()}Z9`;
const userA = randomUUID(); const userB = randomUUID();
const emailA = `delivery-a-${Date.now()}@sugar.invalid`; const emailB = `delivery-b-${Date.now()}@sugar.invalid`;
let projectId;

async function api(path, cookie, init = {}) {
  const response = await fetch(`${appUrl}${path}`, { ...init, headers: { ...(init.headers ?? {}), Cookie: cookie }, signal: AbortSignal.timeout(180_000) });
  const type = response.headers.get("content-type") ?? "";
  return { response, body: type.includes("json") ? await response.json() : new Uint8Array(await response.arrayBuffer()) };
}

try {
  dbQuery(`insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,phone,phone_change,phone_change_token,email_change_token_current,reauthentication_token) values
    ('00000000-0000-0000-0000-000000000000','${userA}','authenticated','authenticated','${emailA}',crypt('${password}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','',null,'','','',''),
    ('00000000-0000-0000-0000-000000000000','${userB}','authenticated','authenticated','${emailB}',crypt('${password}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','',null,'','','','');
    insert into auth.identities(provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values
    ('${userA}','${userA}','{"sub":"${userA}","email":"${emailA}"}','email',now(),now(),now()),('${userB}','${userB}','{"sub":"${userB}","email":"${emailB}"}','email',now(),now(),now());`);
  const [signedA, signedB] = await Promise.all([browserClient().auth.signInWithPassword({ email: emailA, password }), browserClient().auth.signInWithPassword({ email: emailB, password })]);
  assert.ifError(signedA.error); assert.ifError(signedB.error);
  const clientA = browserClient(); await clientA.auth.setSession({ access_token: signedA.data.session.access_token, refresh_token: signedA.data.session.refresh_token });
  const project = await clientA.rpc("create_sugar_project", { p_name: `Delivery ${token}`, p_description: "client delivery" }); assert.ifError(project.error); projectId = project.data.id;
  const cookieA = authCookie(signedA.data.session); const cookieB = authCookie(signedB.data.session);
  const created = await api("/api/client-deliverables", cookieA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, deliverableType: "proposal", title: `客户提案 ${token}`, audience: "客户负责人", purpose: "确认方案", content: `# 正式提案\n\n项目编号 ${token}\n\n- 下一步由客户确认` }) });
  assert.equal(created.response.status, 201, JSON.stringify(created.body)); const id = created.body.deliverable.id;
  const outsider = await api(`/api/client-deliverables?projectId=${projectId}`, cookieB); assert.equal(outsider.response.status, 403);
  const updated = await api(`/api/client-deliverables/${id}`, cookieA, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, content: `# 正式提案 v2\n\n项目编号 ${token}\n\n客户确认后执行。`, changeSummary: "客户措辞校正" }) }); assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
  const approved = await api(`/api/client-deliverables/${id}/approve`, cookieA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) }); assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  for (const format of ["docx", "pdf", "pptx"]) {
    const exported = await api(`/api/client-deliverables/${id}/export/${format}?projectId=${projectId}`, cookieA);
    assert.equal(exported.response.status, 200, `${format}: ${JSON.stringify(exported.body)}`);
    assert.ok(exported.body.length > 500, `${format} export too small`);
  }
  const dispatch = await api(`/api/client-deliverables/${id}/dispatch`, cookieA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, channel: "email", recipient: "client@example.com" }) });
  assert.equal(dispatch.response.status, 503); assert.match(dispatch.body.error, /尚未配置/);
  const list = await api(`/api/client-deliverables?projectId=${projectId}`, cookieA); assert.equal(list.response.status, 200); assert.equal(list.body.deliverables[0].currentVersion.version, 2); assert.equal(list.body.deliverables[0].status, "approved"); assert.equal(list.body.deliverables[0].dispatches[0].status, "failed");
  console.log("Client material versioning, approval gate, DOCX/PDF/PPTX export, dispatch audit, and project RLS passed");
} finally {
  if (projectId) dbQuery(`delete from public.projects where id='${projectId}'::uuid;`);
  dbQuery(`delete from auth.users where id in ('${userA}'::uuid,'${userB}'::uuid);`);
}
