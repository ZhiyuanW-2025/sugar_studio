import { FeishuApiError } from "../../../../../lib/feishu/client";
import { syncFeishuDrive } from "../../../../../lib/feishu/drive-service";
import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = isUuid(body?.projectId) ? body.projectId as string : null;
  const scopeId = isUuid(body?.scopeId) ? body.scopeId as string : null;
  if (!projectId || !scopeId) return Response.json({ error: "同步参数无效。" }, { status: 400, headers });
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { data: scope } = await supabase.from("feishu_drive_scopes").select("id")
      .eq("id", scopeId).eq("project_id", projectId).eq("enabled", true).maybeSingle();
    if (!scope) return Response.json({ error: "没有找到可同步的项目云盘。" }, { status: 404, headers });
    const result = await syncFeishuDrive({ scopeId, requestedBy: user.id });
    return Response.json(result, { headers });
  } catch (error) {
    const status = error instanceof ProjectAccessError ? error.status : error instanceof FeishuApiError && error.status === 403 ? 403 : 500;
    const message = error instanceof ProjectAccessError || error instanceof FeishuApiError
      ? error.message
      : error instanceof Error && error.message === "No model configuration is available for this user."
        ? "请先完成模型设置，再建立媒体内容索引。"
        : "飞书云盘同步失败，请检查权限后重试。";
    return Response.json({ error: message }, { status, headers });
  }
}
