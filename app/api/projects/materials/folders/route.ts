import { createFeishuDriveFolder, createFeishuWikiDocument, FeishuApiError } from "../../../../../lib/feishu/client";
import { syncFeishuDrive } from "../../../../../lib/feishu/drive-service";
import { getFeishuSyncScope } from "../../../../../lib/feishu/scope-service";
import { syncFeishuNodeByToken } from "../../../../../lib/feishu/sync-service";
import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

function cleanName(value: unknown) {
  return typeof value === "string" ? value.replace(/[\\/\0]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) : "";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = isUuid(body?.projectId) ? body.projectId as string : null;
  const scopeId = isUuid(body?.scopeId) ? body.scopeId as string : null;
  const target = body?.target === "knowledge" || body?.target === "drive" ? body.target as "knowledge" | "drive" : null;
  const parentToken = typeof body?.parentToken === "string" && body.parentToken.trim() ? body.parentToken.trim() : null;
  const name = cleanName(body?.name);
  if (!projectId || !scopeId || !target || !name) return fail("新建目录参数无效。", 400);

  try {
    const { supabase, user } = await requireProjectMember(projectId);
    if (target === "knowledge") {
      const { data: visible } = await supabase.from("feishu_sync_scopes").select("id,root_node_token")
        .eq("id", scopeId).eq("project_id", projectId).eq("scope_type", "project").eq("enabled", true).maybeSingle();
      if (!visible) return fail("没有找到可用的飞书知识库连接。", 404);
      if (parentToken && parentToken !== visible.root_node_token) {
        const { data: parent } = await supabase.from("feishu_knowledge_documents").select("node_token")
          .eq("sync_scope_id", scopeId).eq("project_id", projectId).eq("node_token", parentToken).maybeSingle();
        if (!parent) return fail("所选知识库目录不属于当前项目。", 403);
      }
      const scope = await getFeishuSyncScope(scopeId);
      const node = await createFeishuWikiDocument(name, { ...scope, rootNodeToken: parentToken ?? scope.rootNodeToken });
      await syncFeishuNodeByToken({ scopeId, nodeToken: node.nodeToken, requestedBy: user.id, force: true }).catch(() => null);
      return Response.json({ created: true, token: node.nodeToken, name: node.title, target }, { status: 201, headers });
    }

    const { data: driveScope } = await supabase.from("feishu_drive_scopes").select("id,folder_token")
      .eq("id", scopeId).eq("project_id", projectId).eq("enabled", true).maybeSingle();
    if (!driveScope) return fail("没有找到可用的飞书云盘连接。", 404);
    const destination = parentToken ?? driveScope.folder_token;
    if (destination !== driveScope.folder_token) {
      const { data: parent } = await supabase.from("feishu_drive_items").select("file_token")
        .eq("scope_id", scopeId).eq("project_id", projectId).eq("file_token", destination).eq("item_type", "folder").maybeSingle();
      if (!parent) return fail("所选云盘文件夹不属于当前项目。", 403);
    }
    const folder = await createFeishuDriveFolder({ parentFolderToken: destination, name });
    await syncFeishuDrive({ scopeId, requestedBy: user.id });
    return Response.json({ created: true, token: folder.token, name, target }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    if (error instanceof FeishuApiError) return fail(error.message, error.status === 403 ? 403 : 502);
    return fail("暂时无法在飞书新建目录。", 500);
  }
}
