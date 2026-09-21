import { isUuid } from "../../../../../lib/model-config/http";
import { createClient } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ error: "知识文档参数无效。" }, { status: 400, headers });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  const { data: document, error } = await supabase.from("knowledge_documents")
    .select("id, scope, project_id, project_file_id, company_file_id, status, page_count, chunk_count, parser_version, indexed_at, user_description, agent_summary")
    .eq("id", id).maybeSingle();
  if (error || !document) return Response.json({ error: "没有找到该知识文档，或你没有访问权限。" }, { status: 404, headers });
  const page = Math.max(Number(new URL(request.url).searchParams.get("page") || 1), 1);
  const pageSize = 20;
  const { data: chunks, error: chunksError } = await supabase.from("knowledge_chunks")
    .select("id, chunk_index, content, page_number, section_title, token_count, metadata, created_at")
    .eq("document_id", id).order("chunk_index").range((page - 1) * pageSize, page * pageSize - 1);
  if (chunksError) return Response.json({ error: "知识内容预览加载失败。" }, { status: 500, headers });
  let fileName = "知识文件";
  let fileId = "";
  let fileUrl = "";
  if (document.scope === "project" && document.project_file_id) {
    const { data: file } = await supabase.from("project_files").select("id, file_name, source_provider, source_url").eq("id", document.project_file_id).maybeSingle();
    if (file) { fileName = file.file_name; fileId = file.id; fileUrl = file.source_provider === "feishu" && file.source_url ? file.source_url : `/api/projects/files/${file.id}?projectId=${document.project_id}`; }
  } else if (document.company_file_id) {
    const { data: file } = await supabase.from("company_files").select("id, file_name, source_provider, source_url").eq("id", document.company_file_id).maybeSingle();
    if (file) { fileName = file.file_name; fileId = file.id; fileUrl = file.source_provider === "feishu" && file.source_url ? file.source_url : `/api/knowledge/company-files/${file.id}`; }
  }
  return Response.json({
    document: { id: document.id, scope: document.scope, projectId: document.project_id, status: document.status, pageCount: document.page_count, chunkCount: document.chunk_count, parserVersion: document.parser_version, indexedAt: document.indexed_at, userDescription: document.user_description, agentSummary: document.agent_summary, fileId, fileName, fileUrl },
    chunks: chunks ?? [], pagination: { page, pageSize, total: document.chunk_count, hasMore: page * pageSize < document.chunk_count },
  }, { headers });
}
