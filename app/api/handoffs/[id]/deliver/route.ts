import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";
import { getHandoffBriefSchema } from "../../../../../lib/handoffs/briefs";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  if (!isUuid(id) || !isUuid(projectId) || !body?.brief || typeof body.brief !== "object") {
    return errorResponse("交接内容无效。", 400);
  }

  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data: task, error: taskError } = await supabase
      .from("handoff_tasks")
      .select("target_agent")
      .eq("id", id)
      .eq("project_id", projectId)
      .maybeSingle();
    if (taskError || !task || !["coding", "design"].includes(task.target_agent)) {
      return errorResponse("没有找到待发送的交接任务。", 404);
    }
    const parsed = getHandoffBriefSchema(task.target_agent as "coding" | "design").safeParse(body.brief);
    if (!parsed.success) return errorResponse("请检查交接任务中的必填内容。", 400);
    const { data, error } = await supabase.rpc("deliver_handoff_idempotently", {
      p_project_id: projectId,
      p_handoff_id: id,
      p_brief: parsed.data,
    });
    if (error || !data) return errorResponse("任务未能发送，请检查它是否已经处理。", 400);
    return Response.json({ delivered: true, task: data }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    return errorResponse("任务暂时无法发送，请稍后重试。", 500);
  }
}
