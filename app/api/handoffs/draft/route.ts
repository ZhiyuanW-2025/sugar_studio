import { runHandoffBriefAgent } from "../../../../lib/agents/handoff-brief-agent";
import { planningAgentInstructions } from "../../../../lib/agents/planning-agent";
import { resolveAgentInstructions } from "../../../../lib/agents/prompt-service";
import { findAgentThread, readModelHistory } from "../../../../lib/agents/thread-service";
import { handoffBriefTypeForAgent } from "../../../../lib/handoffs/briefs";
import { isUuid } from "../../../../lib/model-config/http";
import { resolveModelConfig } from "../../../../lib/model-config/service";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const targetAgent = body?.targetAgent;
  if (!isUuid(projectId) || !["coding", "design"].includes(targetAgent)) {
    return errorResponse("交接参数无效。", 400);
  }

  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const thread = await findAgentThread(supabase, user.id, projectId, "planning");
    if (!thread) return errorResponse("请先与制作人小花完成讨论。", 409);
    const history = await readModelHistory(supabase, thread);
    if (!history.some((message) => message.role === "assistant")) {
      return errorResponse("请先让制作人小花整理任务内容。", 409);
    }

    const resolved = await resolveModelConfig(user.id, "planning");
    if (resolved.provider !== "openai") return errorResponse("当前暂时只支持 OpenAI 模型。", 422);
    const prompt = await resolveAgentInstructions(supabase, "planning", planningAgentInstructions);
    const [{ data: project, error: projectError }, { data: snapshot, error: snapshotError }] = await Promise.all([
      supabase.from("projects").select("name").eq("id", projectId).maybeSingle(),
      supabase.from("project_snapshots").select("current_plan_version_id").eq("project_id", projectId).maybeSingle(),
    ]);
    if (projectError || !project || snapshotError) {
      return errorResponse("暂时无法读取交接任务所需的项目信息。", 500);
    }
    const run = await runHandoffBriefAgent({
      targetAgent,
      history,
      model: resolved.model,
      apiKey: resolved.apiKey,
      planningInstructions: prompt.instructions,
      projectName: project.name,
      sourcePlanVersion: snapshot?.current_plan_version_id ?? null,
    });

    const { data, error } = await supabase.rpc("create_handoff_draft", {
      p_project_id: projectId,
      p_source_thread_id: thread.id,
      p_target_agent: targetAgent,
      p_source_plan_version: snapshot?.current_plan_version_id ?? null,
      p_brief: run.brief,
    });
    if (error || !data) return errorResponse("交接草稿生成成功，但暂时无法保存。", 500);

    return Response.json({
      taskId: data.id,
      targetAgent,
      briefType: handoffBriefTypeForAgent(targetAgent),
      brief: data.brief,
      title: data.title,
      content: data.content,
    }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    if (error instanceof Error && error.message === "No model configuration is available for this user.") {
      return errorResponse("请先在设置中完成模型配置。", 409);
    }
    return errorResponse("制作人小花暂时无法生成交接草稿，请稍后重试。", 502);
  }
}
