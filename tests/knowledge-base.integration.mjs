import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { strToU8, zipSync } from "fflate";

const appUrl = process.env.SUGAR_APP_URL ?? "http://localhost:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error("Load .env.local before running this integration test.");
}

const userAId = randomUUID();
const userBId = randomUUID();
const projectAId = randomUUID();
const projectBId = randomUUID();
const token = randomUUID().slice(0, 8);
const projectFact = `Moon-Moi-KB-${token} 的任务时限是 217 秒`;
const companyFact = `Sugar-Method-${token} 要求客户材料先标记内部草稿`;
const emailA = `knowledge-a-${Date.now()}@sugar.invalid`;
const emailB = `knowledge-b-${Date.now()}@sugar.invalid`;
const passwordA = `Sugar!${randomUUID()}Z9`;
const passwordB = `Sugar!${randomUUID()}Z9`;
const projectStoragePaths = [];
let companyFileId;
let companyStoragePath;
let firstProjectDocumentId;
let companyDocumentId;
let fixturesCreated = false;

const dbQuery = (sql) => execFileSync("npx", ["supabase", "db", "query", "--linked", sql], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

const authClient = () => createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const admin = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const cookie = (session) =>
  `sb-${projectRef}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;

async function jsonCall(path, cookieValue, init = {}) {
  const response = await fetch(`${appUrl}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Cookie: cookieValue },
    signal: AbortSignal.timeout(180_000),
  });
  return { response, body: await response.json().catch(() => null) };
}

async function upload(path, cookieValue, name, content, projectId, userDescription) {
  const form = new FormData();
  form.set("file", new File([content], name, { type: "text/plain" }));
  if (projectId) form.set("projectId", projectId);
  if (userDescription) form.set("userDescription", userDescription);
  return jsonCall(path, cookieValue, { method: "POST", body: form });
}

function createPdf(text) {
  const safe = text.replace(/[()\\]/g, (character) => `\\${character}`);
  const stream = `BT /F1 12 Tf 72 720 Td (${safe}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function createDocx(text) {
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
  });
}

function createPptx(text) {
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    "ppt/slides/slide1.xml": strToU8(`<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><a:t>${text}</a:t></p:cSld></p:sld>`),
  });
}

function createXlsx(text) {
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    "xl/sharedStrings.xml": strToU8(`<?xml version="1.0"?><sst><si><t>${text}</t></si></sst>`),
    "xl/worksheets/sheet1.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData><row><c t="s"><v>0</v></c></row></sheetData></worksheet>'),
  });
}

try {
  dbQuery(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      phone, phone_change, phone_change_token, email_change_token_current, reauthentication_token
    ) values
      ('00000000-0000-0000-0000-000000000000'::uuid, '${userAId}'::uuid, 'authenticated', 'authenticated', '${emailA}', crypt('${passwordA}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Knowledge A"}'::jsonb, now(), now(), '', '', '', '', null, '', '', '', ''),
      ('00000000-0000-0000-0000-000000000000'::uuid, '${userBId}'::uuid, 'authenticated', 'authenticated', '${emailB}', crypt('${passwordB}', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Knowledge B"}'::jsonb, now(), now(), '', '', '', '', null, '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values
      ('${userAId}', '${userAId}'::uuid, '{"sub":"${userAId}","email":"${emailA}","email_verified":true,"phone_verified":false}'::jsonb, 'email', now(), now(), now()),
      ('${userBId}', '${userBId}'::uuid, '{"sub":"${userBId}","email":"${emailB}","email_verified":true,"phone_verified":false}'::jsonb, 'email', now(), now(), now());
    insert into public.projects (id, name, description, status) values
      ('${projectAId}'::uuid, 'Knowledge A ${token}', 'Knowledge project A', 'active'),
      ('${projectBId}'::uuid, 'Knowledge B ${token}', 'Knowledge project B', 'active');
    insert into public.project_snapshots (project_id, summary, current_plan_summary, current_stage) values
      ('${projectAId}'::uuid, 'A snapshot', 'A current plan', 'production'),
      ('${projectBId}'::uuid, 'B snapshot', 'B current plan', 'planning');
    insert into public.project_members (project_id, user_id, role) values
      ('${projectAId}'::uuid, '${userAId}'::uuid, 'member'),
      ('${projectBId}'::uuid, '${userBId}'::uuid, 'member');
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

  const originalDescription = `这是 Moon Moi 的任务时限依据，供策划和客户材料使用；不得改写为估算值。`;
  const projectUpload = await upload("/api/projects/files", cookieA, `project-${token}.txt`, projectFact, projectAId, originalDescription);
  assert.equal(projectUpload.response.status, 201, JSON.stringify(projectUpload.body));
  projectStoragePaths.push(projectUpload.body.file.storage_path);
  assert.equal(projectUpload.body.knowledge.status, "pending");
  firstProjectDocumentId = projectUpload.body.knowledge.documentId;
  const projectIndex = await jsonCall(
    `/api/knowledge/documents/${projectUpload.body.knowledge.documentId}/index`,
    cookieA,
    { method: "POST" },
  );
  assert.equal(projectIndex.response.status, 200, JSON.stringify(projectIndex.body));
  assert.equal(projectIndex.body.status, "ready");
  assert.ok(projectIndex.body.chunkCount >= 1);

  for (const fixture of [
    { name: `brief-${token}.pdf`, content: createPdf(`PDF-KB-${token} requires printed clue cards`) },
    { name: `notes-${token}.docx`, content: createDocx(`DOCX-KB-${token} requires client approval`) },
    { name: `deck-${token}.pptx`, content: createPptx(`PPTX-KB-${token} uses restrained typography`) },
    { name: `schedule-${token}.xlsx`, content: createXlsx(`XLSX-KB-${token} production checkpoint`) },
  ]) {
    const uploaded = await upload("/api/projects/files", cookieA, fixture.name, fixture.content, projectAId);
    assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.body));
    assert.ok(uploaded.body.knowledge, `${fixture.name} missing knowledge document: ${JSON.stringify(uploaded.body)}`);
    projectStoragePaths.push(uploaded.body.file.storage_path);
    const indexed = await jsonCall(
      `/api/knowledge/documents/${uploaded.body.knowledge.documentId}/index`,
      cookieA,
      { method: "POST" },
    );
    assert.equal(indexed.response.status, 200, `${fixture.name}: ${JSON.stringify(indexed.body)}`);
    assert.equal(indexed.body.status, "ready");
    assert.ok(indexed.body.chunkCount >= 1);
  }

  const companyUpload = await upload("/api/knowledge/company-files", cookieA, `company-${token}.md`, companyFact);
  assert.equal(companyUpload.response.status, 201, JSON.stringify(companyUpload.body));
  companyFileId = companyUpload.body.file.id;
  companyStoragePath = companyUpload.body.file.storage_path;
  companyDocumentId = companyUpload.body.knowledge.documentId;
  const companyIndex = await jsonCall(
    `/api/knowledge/documents/${companyUpload.body.knowledge.documentId}/index`,
    cookieA,
    { method: "POST" },
  );
  assert.equal(companyIndex.response.status, 200, JSON.stringify(companyIndex.body));
  assert.equal(companyIndex.body.status, "ready");

  const projectFiles = await jsonCall(`/api/projects/files?projectId=${projectAId}`, cookieA);
  assert.equal(projectFiles.response.status, 200);
  assert.equal(projectFiles.body.files[0].knowledge.status, "ready");
  const describedFile = projectFiles.body.files.find((file) => file.id === projectUpload.body.file.id);
  assert.equal(describedFile.knowledge.userDescription, originalDescription);

  const forbiddenProject = await jsonCall(`/api/projects/files?projectId=${projectAId}`, cookieB);
  assert.equal(forbiddenProject.response.status, 403);
  const sharedCompany = await jsonCall("/api/knowledge/company-files", cookieB);
  assert.equal(sharedCompany.response.status, 200);
  assert.ok(sharedCompany.body.files.some((file) => file.id === companyFileId));

  const agent = await jsonCall("/api/agents/planning/messages", cookieA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: projectAId,
      requestId: randomUUID(),
      message: `请搜索项目和公司知识库，分别告诉我 ${projectFact.split(" 的")[0]} 的时限，以及 ${companyFact.split(" 要求")[0]} 的客户材料规则，并注明来源。`,
      knowledgeAttachments: [{
        documentId: firstProjectDocumentId,
        fileName: projectUpload.body.file.file_name,
        scope: "project",
        indexStatus: "ready",
      }],
    }),
  });
  assert.equal(agent.response.status, 200, JSON.stringify(agent.body));
  assert.ok(agent.body.toolCalls.includes("search_project_knowledge"));
  assert.ok(agent.body.toolCalls.includes("save_knowledge_file_descriptions"));
  assert.match(agent.body.reply, /217/);
  assert.match(agent.body.reply, /内部草稿/);
  const describedDocument = await admin.from("knowledge_documents")
    .select("user_description, agent_summary").eq("id", firstProjectDocumentId).single();
  assert.equal(describedDocument.data?.user_description, originalDescription);
  assert.match(describedDocument.data?.agent_summary ?? "", /用途|重点|限制|时限/);

  const deletedProject = await jsonCall(`/api/projects/files/${projectUpload.body.file.id}?projectId=${projectAId}`, cookieA, { method: "DELETE" });
  assert.equal(deletedProject.response.status, 200);
  const deletedProjectDocument = await admin.from("knowledge_documents").select("id").eq("id", firstProjectDocumentId);
  assert.equal(deletedProjectDocument.data?.length ?? 0, 0);

  const deletedCompany = await jsonCall(`/api/knowledge/company-files/${companyFileId}`, cookieA, { method: "DELETE" });
  assert.equal(deletedCompany.response.status, 200);
  const deletedCompanyDocument = await admin.from("knowledge_documents").select("id").eq("id", companyDocumentId);
  assert.equal(deletedCompanyDocument.data?.length ?? 0, 0);
  companyFileId = undefined;
  companyStoragePath = undefined;

  const outsiderChunks = await authClient().from("knowledge_chunks").select("id");
  assert.equal(outsiderChunks.data?.length ?? 0, 0);

  console.log("Knowledge ingestion, project/company RLS, hybrid Agent retrieval, and source status passed");
} finally {
  if (projectStoragePaths.length > 0) await admin.storage.from("project-files").remove(projectStoragePaths);
  if (companyFileId) {
    if (companyStoragePath) await admin.storage.from("company-knowledge").remove([companyStoragePath]);
    await admin.from("company_files").delete().eq("id", companyFileId);
  }
  if (fixturesCreated) {
    dbQuery(`
      do $$ declare config record; begin
        for config in select id from public.user_model_configs where user_id = '${userAId}'::uuid loop
          perform public.delete_user_model_config('${userAId}'::uuid, config.id);
        end loop;
      end $$;
      delete from auth.users where id in ('${userAId}'::uuid, '${userBId}'::uuid);
      delete from public.projects where id in ('${projectAId}'::uuid, '${projectBId}'::uuid);
    `);
  }
}
