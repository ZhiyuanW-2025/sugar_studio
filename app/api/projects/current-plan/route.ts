import { isUuid } from "../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";
import { preparePlanSavePreview } from "../../../../lib/projects/plan-service";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };
const maximumPlanLength = 80_000;

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers: responseHeaders });
}

function accessErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return errorResponse(error.message, error.status);
  }
  return errorResponse("暂时无法访问项目，请稍后重试。", 500);
}

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return errorResponse("项目参数无效。", 400);

  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const preview = await preparePlanSavePreview(supabase, user.id, projectId);
    if (!preview) {
      return errorResponse("请先让制作人小花整理一版方案，再进行保存。", 409);
    }
    return Response.json(preview, { headers: responseHeaders });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const sourceThreadId = body?.sourceThreadId;
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const changeSummary =
    typeof body?.changeSummary === "string" ? body.changeSummary.trim() : "";

  if (
    !isUuid(projectId) ||
    !isUuid(sourceThreadId) ||
    !content ||
    content.length > maximumPlanLength ||
    !changeSummary ||
    changeSummary.length > 4_000
  ) {
    return errorResponse("待保存的方案内容无效。", 400);
  }

  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data, error } = await supabase.rpc("save_current_plan", {
      p_project_id: projectId,
      p_source_thread_id: sourceThreadId,
      p_content: content,
      p_change_summary: changeSummary,
    });

    if (error || !Array.isArray(data) || !data[0]) {
      return errorResponse("暂时无法保存正式方案，请稍后重试。", 500);
    }

    return Response.json(
      { saved: true, plan: data[0] },
      { status: 201, headers: responseHeaders },
    );
  } catch (error) {
    return accessErrorResponse(error);
  }
}
