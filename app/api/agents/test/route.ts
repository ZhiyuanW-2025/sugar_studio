import { getAgentDefinition } from "../../../../lib/agents/catalog";
import { codingAgentInstructions } from "../../../../lib/agents/coding-agent";
import { runCodexDiscussion } from "../../../../lib/agents/codex-discussion";
import { clientAgentInstructions, runClientAgent } from "../../../../lib/agents/client-agent";
import { designAgentInstructions, runDesignAgent } from "../../../../lib/agents/design-agent";
import { planningAgentInstructions, runPlanningAgent } from "../../../../lib/agents/planning-agent";
import { procurementAgentInstructions, runProcurementAgent } from "../../../../lib/agents/procurement-agent";
import { marketingAgentInstructions, runMarketingAgent } from "../../../../lib/agents/marketing-agent";
import { resolveAgentInstructions } from "../../../../lib/agents/prompt-service";
import { isUuid } from "../../../../lib/model-config/http";
import { resolveModelConfig } from "../../../../lib/model-config/service";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";
import { getOrCreateAgentThread } from "../../../../lib/agents/thread-service";
import { buildFullSkillInstructions, buildSkillMetadataInstructions, resolveActiveAgentSkills } from "../../../../lib/agents/skill-service";
import { createLoadAgentSkillTool } from "../../../../lib/agents/tools/load-agent-skill";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers });

const runtimes = {
  planning: { fallback: planningAgentInstructions, run: runPlanningAgent },
  design: { fallback: designAgentInstructions, run: runDesignAgent },
  client: { fallback: clientAgentInstructions, run: runClientAgent },
  procurement: { fallback: procurementAgentInstructions, run: runProcurementAgent },
  marketing: { fallback: marketingAgentInstructions, run: runMarketingAgent },
} as const;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const definition = getAgentDefinition(body?.agentType ?? "");
  const projectId = body?.projectId;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!definition || !isUuid(projectId) || !message || message.length > 8_000) {
    return errorResponse("测试参数无效。", 400);
  }

  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const fallback = definition.type === "coding"
      ? codingAgentInstructions
      : runtimes[definition.type].fallback;
    const [{ data: project, error: projectError }, model, prompt, activeSkills] = await Promise.all([
      supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
      resolveModelConfig(user.id, definition.type),
      resolveAgentInstructions(supabase, definition.type, fallback),
      resolveActiveAgentSkills(supabase, definition.type),
    ]);
    if (projectError || !project) return errorResponse("没有找到当前项目。", 404);
    if (model.provider !== "openai") return errorResponse("当前 Agent 测试暂时只支持 OpenAI 模型。", 422);

    const startedAt = performance.now();
    const loadedSkillSlugs: string[] = [];
    const baseInput = {
      message,
      history: [],
      model: model.model,
      apiKey: model.apiKey,
      instructions: `${prompt.instructions}${definition.type === "coding" ? buildFullSkillInstructions(activeSkills) : buildSkillMetadataInstructions(activeSkills)}`,
      projectContext: { supabase, userId: user.id, projectId },
      runtimeTools: definition.type !== "coding" && activeSkills.length > 0
        ? [createLoadAgentSkillTool(activeSkills, (slug) => loadedSkillSlugs.push(slug))]
        : [],
    };
    const result = definition.type === "coding"
      ? await runCodexDiscussion({
          ...baseInput,
          thread: await getOrCreateAgentThread(supabase, user.id, projectId, "coding"),
        })
      : await runtimes[definition.type].run(baseInput);
    const durationMs = Math.max(1, Math.round(performance.now() - startedAt));

    return Response.json({
      agent: { type: definition.type, name: definition.name },
      model: { provider: model.provider, model: model.model },
      prompt: { source: prompt.source, version: prompt.version },
      project: { id: project.id, name: project.name },
      reply: result.reply,
      calledProjectContext: (result.toolCalls as string[]).includes("get_project_context"),
      calledKnowledgeSearch: (result.toolCalls as string[]).includes("search_project_knowledge"),
      toolCalls: result.toolCalls,
      skills: {
        available: activeSkills.map((skill) => ({ slug: skill.slug, name: skill.name, version: skill.version })),
        loaded: [...new Set(loadedSkillSlugs)],
      },
      durationMs,
      traceId: "traceId" in result ? result.traceId : undefined,
    }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    if (error instanceof Error && error.message === "No model configuration is available for this user.") {
      return errorResponse("请先在设置中完成模型配置。", 409);
    }
    return errorResponse("Agent 测试暂时无法完成，请稍后重试。", 502);
  }
}
