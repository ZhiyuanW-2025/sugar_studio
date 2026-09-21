import { FeishuApiError } from "../../../../../lib/feishu/client";
import { createFeishuDriveScope, resolveFeishuDriveFolderUrl } from "../../../../../lib/feishu/drive-service";
import { FeishuUrlError } from "../../../../../lib/feishu/url";
import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function safeError(error: unknown) {
  if (error instanceof ProjectAccessError) return { status: error.status, message: error.message };
  if (error instanceof FeishuUrlError) return { status: 400, message: error.message };
  if (error instanceof FeishuApiError) return { status: error.status === 403 ? 403 : 502, message: error.message };
  return { status: 500, message: "暂时无法连接飞书云盘。" };
}

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return Response.json({ error: "项目参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data, error } = await supabase.from("feishu_drive_scopes").select("*")
      .eq("project_id", projectId).eq("enabled", true).order("created_at", { ascending: false });
    if (error) throw new Error("FEISHU_DRIVE_SCOPE_LIST_FAILED");
    return Response.json({ scopes: data ?? [] }, { headers });
  } catch (error) {
    const safe = safeError(error);
    return Response.json({ error: safe.message }, { status: safe.status, headers });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = isUuid(body?.projectId) ? body.projectId as string : null;
  const sourceUrl = typeof body?.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  if (!projectId || !sourceUrl) return Response.json({ error: "请选择项目并填写具体云盘文件夹地址。" }, { status: 400, headers });
  try {
    const { user } = await requireProjectMember(projectId);
    if (body?.validateOnly === true) {
      const resolved = await resolveFeishuDriveFolderUrl(sourceUrl);
      return Response.json({ resolved }, { headers });
    }
    const result = await createFeishuDriveScope({
      projectId,
      sourceUrl,
      createdBy: user.id,
      syncFrequency: body?.syncFrequency === "manual" ? "manual" : "weekly",
    });
    return Response.json(result, { status: 201, headers });
  } catch (error) {
    const safe = safeError(error);
    return Response.json({ error: safe.message }, { status: safe.status, headers });
  }
}
