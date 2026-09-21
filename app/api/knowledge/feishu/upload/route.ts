import { WorkspaceAccessError, requireWorkspaceMember } from "../../../../../lib/knowledge/access";
import { FeishuApiError, uploadFileToFeishuWiki } from "../../../../../lib/feishu/client";
import { FEISHU_UPLOAD_MAX_BYTES, FeishuConfigError } from "../../../../../lib/feishu/config";
import { syncFeishuNodeByToken } from "../../../../../lib/feishu/sync-service";
import { mirrorFeishuUploadedFile } from "../../../../../lib/feishu/sync-service";
import { getAllowedProjectFile, sanitizeProjectFileName } from "../../../../../lib/projects/file-types";
import { chooseFeishuSyncScope, getFeishuSyncScope } from "../../../../../lib/feishu/scope-service";
import { isUuid } from "../../../../../lib/model-config/http";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireWorkspaceMember();
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const scopeIdValue = form?.get("scopeId");
    const projectIdValue = form?.get("projectId");
    const userDescriptionValue = form?.get("userDescription");
    const userDescription = typeof userDescriptionValue === "string" ? userDescriptionValue.trim().slice(0, 8_000) : "";
    const scopeId = typeof scopeIdValue === "string" && isUuid(scopeIdValue) ? scopeIdValue : null;
    const projectId = typeof projectIdValue === "string" && isUuid(projectIdValue) ? projectIdValue : null;
    if (!(file instanceof File)) return Response.json({ error: "请选择要上传到飞书的文件。" }, { status: 400, headers });
    if (file.size <= 0 || file.size > FEISHU_UPLOAD_MAX_BYTES) {
      return Response.json({ error: "飞书单文件上传上限为 20 MB。" }, { status: 400, headers });
    }
    const fileName = sanitizeProjectFileName(file.name);
    const allowed = getAllowedProjectFile(fileName);
    if (!fileName || !allowed) return Response.json({ error: "暂不支持该文件格式。" }, { status: 415, headers });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (projectId) {
      const { data: membership } = await supabase.from("project_members").select("id")
        .eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
      if (!membership) return Response.json({ error: "你不是该项目成员。" }, { status: 403, headers });
    }
    let scope;
    if (scopeId) {
      const { data: visible } = await supabase.from("feishu_sync_scopes").select("id").eq("id", scopeId).eq("enabled", true).maybeSingle();
      if (!visible) return Response.json({ error: "你无权使用该飞书知识范围。" }, { status: 403, headers });
      scope = await getFeishuSyncScope(scopeId);
    } else {
      scope = await chooseFeishuSyncScope(projectId);
    }
    if (scope.scopeType === "project" && scope.projectId !== projectId) {
      return Response.json({ error: "所选飞书目录不属于当前项目。" }, { status: 400, headers });
    }
    if (scope.scopeType === "company" && projectId) return Response.json({ error: "公司共享资料不能绑定具体项目。" }, { status: 400, headers });
    const result = await uploadFileToFeishuWiki({
      fileName,
      bytes,
      mimeType: file.type || allowed.mimeType,
      scope,
    });
    const knowledge = await mirrorFeishuUploadedFile({
      scope,
      fileToken: result.fileToken,
      nodeToken: result.nodeToken,
      sourceUrl: result.url,
      fileName,
      fileType: allowed.extension,
      mimeType: file.type || allowed.mimeType,
      bytes,
      uploadedBy: user.id,
    });
    if (knowledge.documentId && userDescription) {
      const { error: descriptionError } = await supabase.rpc("update_knowledge_document_descriptions", {
        p_document_id: knowledge.documentId,
        p_user_description: userDescription,
        p_agent_summary: null,
      });
      if (descriptionError) throw new Error("KNOWLEDGE_DESCRIPTION_SAVE_FAILED");
    }
    const synced = result.nodeToken
      ? await syncFeishuNodeByToken({ scopeId: scope.id, nodeToken: result.nodeToken, requestedBy: user.id, force: true }).catch(() => null)
      : null;
    if (result.nodeToken) {
      await createAdminClient().from("feishu_knowledge_documents").update(
        scope.scopeType === "company"
          ? { company_file_id: knowledge.fileId }
          : { project_file_id: knowledge.fileId },
      ).eq("sync_scope_id", scope.id).eq("node_token", result.nodeToken);
    }
    return Response.json({
      uploaded: true,
      fileName,
      ...result,
      knowledge,
      synced,
      notice: result.taskId ? "文件已交给飞书处理，完成后会在下一次同步中出现。" : "文件已上传到飞书企业知识库。",
    }, { status: 201, headers });
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status
      : error instanceof FeishuConfigError ? 409
        : error instanceof FeishuApiError ? error.status === 403 ? 403 : 502
          : error instanceof Error && error.message === "FEISHU_SCOPE_NOT_FOUND" ? 409
          : 500;
    const message = error instanceof WorkspaceAccessError || error instanceof FeishuConfigError || error instanceof FeishuApiError
      ? error.message
      : error instanceof Error && error.message === "FEISHU_SCOPE_NOT_FOUND"
        ? "请先在知识库页面连接一个飞书知识目录。"
      : "文件暂时无法上传到飞书知识库。";
    return Response.json({ error: message }, { status, headers });
  }
}
