import { FeishuApiError, uploadFileToFeishuDriveFolder, uploadFileToFeishuWiki } from "../../../../../lib/feishu/client";
import { FEISHU_UPLOAD_MAX_BYTES } from "../../../../../lib/feishu/config";
import { syncFeishuDrive } from "../../../../../lib/feishu/drive-service";
import { getFeishuSyncScope } from "../../../../../lib/feishu/scope-service";
import { mirrorFeishuUploadedFile, syncFeishuNodeByToken } from "../../../../../lib/feishu/sync-service";
import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";
import { getAllowedProjectFile, projectMaterialTarget, sanitizeProjectFileName } from "../../../../../lib/projects/file-types";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const projectId = form?.get("projectId");
  const scopeId = form?.get("scopeId");
  const parentTokenValue = form?.get("parentToken");
  const file = form?.get("file");
  const descriptionValue = form?.get("userDescription");
  if (!isUuid(projectId) || !isUuid(scopeId) || !(file instanceof File)) return fail("请选择文件和飞书保存位置。", 400);
  const fileName = sanitizeProjectFileName(file.name);
  const allowed = getAllowedProjectFile(fileName);
  const target = projectMaterialTarget(fileName);
  if (!allowed || !target) return fail("暂不支持该文件格式。", 415);
  if (file.size <= 0 || file.size > FEISHU_UPLOAD_MAX_BYTES) return fail("上传到飞书的单个文件必须小于 20 MB。", 400);
  const parentToken = typeof parentTokenValue === "string" && parentTokenValue.trim() ? parentTokenValue.trim() : null;
  const userDescription = typeof descriptionValue === "string" ? descriptionValue.trim().slice(0, 8_000) : "";

  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (target === "knowledge") {
      const { data: visible } = await supabase.from("feishu_sync_scopes").select("id,root_node_token")
        .eq("id", scopeId).eq("project_id", projectId).eq("scope_type", "project").eq("enabled", true).maybeSingle();
      if (!visible) return fail("当前项目尚未连接飞书知识库。", 409);
      if (parentToken && parentToken !== visible.root_node_token) {
        const { data: parent } = await supabase.from("feishu_knowledge_documents").select("node_token")
          .eq("sync_scope_id", scopeId).eq("project_id", projectId).eq("node_token", parentToken).maybeSingle();
        if (!parent) return fail("所选知识库目录不属于当前项目。", 403);
      }
      const scope = await getFeishuSyncScope(scopeId);
      const result = await uploadFileToFeishuWiki({
        fileName, bytes, mimeType: file.type || allowed.mimeType, scope,
        parentNodeToken: parentToken ?? scope.rootNodeToken,
      });
      const knowledge = await mirrorFeishuUploadedFile({
        scope, fileToken: result.fileToken, nodeToken: result.nodeToken, sourceUrl: result.url,
        fileName, fileType: allowed.extension, mimeType: file.type || allowed.mimeType, bytes, uploadedBy: user.id,
      });
      if (knowledge.documentId && userDescription) {
        await supabase.rpc("update_knowledge_document_descriptions", {
          p_document_id: knowledge.documentId, p_user_description: userDescription, p_agent_summary: null,
        });
      }
      const synced = result.nodeToken
        ? await syncFeishuNodeByToken({ scopeId, nodeToken: result.nodeToken, requestedBy: user.id, force: true }).catch(() => null)
        : null;
      if (result.nodeToken) {
        await createAdminClient().from("feishu_knowledge_documents").update({ project_file_id: knowledge.fileId })
          .eq("sync_scope_id", scopeId).eq("node_token", result.nodeToken);
      }
      return Response.json({ uploaded: true, target, fileName, url: result.url, knowledge, synced }, { status: 201, headers });
    }

    const { data: driveScope } = await supabase.from("feishu_drive_scopes").select("id,folder_token")
      .eq("id", scopeId).eq("project_id", projectId).eq("enabled", true).maybeSingle();
    if (!driveScope) return fail("当前项目尚未连接飞书云盘。", 409);
    const destination = parentToken ?? driveScope.folder_token;
    if (destination !== driveScope.folder_token) {
      const { data: parent } = await supabase.from("feishu_drive_items").select("file_token")
        .eq("scope_id", scopeId).eq("project_id", projectId).eq("file_token", destination).eq("item_type", "folder").maybeSingle();
      if (!parent) return fail("所选云盘文件夹不属于当前项目。", 403);
    }
    const uploaded = await uploadFileToFeishuDriveFolder({
      folderToken: destination, fileName, bytes, mimeType: file.type || allowed.mimeType,
    });
    const sync = await syncFeishuDrive({ scopeId, requestedBy: user.id });
    return Response.json({ uploaded: true, target, fileName, fileToken: uploaded.fileToken, sync }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    if (error instanceof FeishuApiError) return fail(error.message, error.status === 403 ? 403 : 502);
    return fail("文件暂时无法保存到飞书。", 500);
  }
}
