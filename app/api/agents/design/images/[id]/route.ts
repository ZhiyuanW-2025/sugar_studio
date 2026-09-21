import { isUuid } from "../../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "no-store" };

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers: responseHeaders });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const approved = body?.approved;

  if (!isUuid(id) || !isUuid(projectId) || typeof approved !== "boolean") {
    return errorResponse("图片成果确认参数无效。", 400);
  }

  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data, error } = await supabase.rpc("set_image_generation_approval", {
      p_project_id: projectId,
      p_generation_id: id,
      p_approved: approved,
    });
    const result = Array.isArray(data) ? data[0] : data;
    if (error || !result) {
      return errorResponse(
        error?.code === "P0002" ? "没有找到该项目图片。" : "暂时无法更新图片成果状态。",
        error?.code === "P0002" ? 404 : 409,
      );
    }

    return Response.json({
      ok: true,
      reviewStatus: result.review_status,
      approvedBy: result.approved_by,
      approvedAt: result.approved_at,
    }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    return errorResponse("暂时无法更新图片成果状态。", 500);
  }
}
