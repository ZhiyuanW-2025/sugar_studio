import { isUuid } from "../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";
import { getAllowedProjectFile, MAX_PROJECT_FILE_SIZE, sanitizeProjectFileName } from "../../../../lib/projects/file-types";
import { sha256Hex } from "../../../../lib/knowledge/checksum";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function GET() {
  try {
    const { supabase, user } = await requireProjectMember((await getInboxProjectId()) || crypto.randomUUID());
    const { data, error } = await supabase.from("project_files")
      .select("id, file_name, file_type, size, created_at, inbox_source_project_id, knowledge_documents(id,status,user_description,agent_summary)")
      .eq("inbox_owner_id", user.id).eq("archive_state", "unarchived").order("created_at", { ascending: false });
    if (error) return fail("暂时无法加载未归档文件。", 500);
    const sourceIds = [...new Set((data ?? []).map((item) => item.inbox_source_project_id).filter(Boolean))];
    const { data: sources } = sourceIds.length ? await supabase.from("projects").select("id,name").in("id", sourceIds) : { data: [] };
    const names = new Map((sources ?? []).map((item) => [item.id, item.name]));
    return Response.json({ files: (data ?? []).map((item) => ({
      id: item.id, fileName: item.file_name, fileType: item.file_type, size: item.size, createdAt: item.created_at,
      sourceProjectId: item.inbox_source_project_id, sourceProjectName: names.get(item.inbox_source_project_id) || "未知项目",
      knowledge: Array.isArray(item.knowledge_documents) ? item.knowledge_documents[0] ?? null : item.knowledge_documents,
    })) }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    return fail("暂时无法加载未归档文件。", 500);
  }
}

async function getInboxProjectId() {
  const { createClient } = await import("../../../../lib/supabase/server");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new ProjectAccessError(401, "请先登录后继续。");
  const { data, error } = await supabase.rpc("get_or_create_unarchived_project");
  if (error || !isUuid(data)) throw new Error("INBOX_CREATE_FAILED");
  return data;
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const sourceProjectId = form?.get("sourceProjectId");
  const file = form?.get("file");
  const descriptionValue = form?.get("userDescription");
  if (!isUuid(sourceProjectId) || !(file instanceof File)) return fail("请选择要上传的文件。", 400);
  if (file.size <= 0 || file.size > MAX_PROJECT_FILE_SIZE) return fail("文件大小必须在 25 MB 以内。", 400);
  const fileName = sanitizeProjectFileName(file.name);
  const allowed = getAllowedProjectFile(fileName);
  if (!allowed) return fail("暂不支持该文件格式。", 415);

  try {
    const { supabase } = await requireProjectMember(sourceProjectId);
    const inboxProjectId = await getInboxProjectId();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checksum = await sha256Hex(bytes);
    const fileId = crypto.randomUUID();
    const storagePath = `${inboxProjectId}/${fileId}/source.${allowed.extension}`;
    const { error: uploadError } = await supabase.storage.from("project-files").upload(storagePath, bytes, { contentType: allowed.mimeType, cacheControl: "3600", upsert: false });
    if (uploadError) return fail("文件上传失败，请稍后重试。", 500);
    const { data, error } = await supabase.rpc("register_project_file_v2", {
      p_id: fileId, p_project_id: inboxProjectId, p_file_name: fileName, p_storage_path: storagePath,
      p_file_type: allowed.extension, p_mime_type: allowed.mimeType, p_size: file.size, p_checksum: checksum, p_replaces_file_id: null,
    });
    if (error || !data) { await supabase.storage.from("project-files").remove([storagePath]); return fail("文件信息保存失败，上传已撤销。", 500); }
    const { error: stagedError } = await supabase.rpc("mark_project_file_staged", { p_file_id: fileId, p_source_project_id: sourceProjectId });
    if (stagedError) { await supabase.storage.from("project-files").remove([storagePath]); await supabase.rpc("remove_project_file", { p_project_id: inboxProjectId, p_file_id: fileId }); return fail("暂存文件失败。", 500); }
    const { data: document } = await supabase.from("knowledge_documents").select("id,status").eq("project_file_id", fileId).maybeSingle();
    const userDescription = typeof descriptionValue === "string" ? descriptionValue.trim().slice(0, 8000) : "";
    if (document && userDescription) await supabase.rpc("update_knowledge_document_descriptions", { p_document_id: document.id, p_user_description: userDescription, p_agent_summary: null });
    return Response.json({ uploaded: true, file: data, knowledge: document ? { documentId: document.id, status: document.status } : null }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    return fail("文件暂存失败，请稍后重试。", 500);
  }
}
