import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { clientAgentInstructions } from "./client-agent";
import { codingAgentInstructions } from "./coding-agent";
import { designAgentInstructions } from "./design-agent";
import { getAgentDefinition } from "./catalog";
import { marketingAgentInstructions } from "./marketing-agent";
import { planningAgentInstructions, runSugarAgent } from "./planning-agent";
import { procurementAgentInstructions } from "./procurement-agent";
import { resolveAgentInstructions } from "./prompt-service";
import { buildFullSkillInstructions, resolveActiveAgentSkills } from "./skill-service";
import { resolveModelConfig, resolveModelConfigById } from "../model-config/service";
import type { ModelAgentType } from "../model-config/catalog";
import type { AgentTestKnowledgeSource } from "./test-workbench";

const fallbackInstructions: Record<ModelAgentType, string> = {
  planning: planningAgentInstructions,
  coding: codingAgentInstructions,
  design: designAgentInstructions,
  client: clientAgentInstructions,
  procurement: procurementAgentInstructions,
  marketing: marketingAgentInstructions,
};

export function resolveAgentTestPrompt(supabase: SupabaseClient, agentType: ModelAgentType) {
  return resolveAgentInstructions(supabase, agentType, fallbackInstructions[agentType]);
}

export async function runAgentTestVersion(input: {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  agentType: ModelAgentType;
  message: string;
  modelConfigId: string | null;
  promptOverride: string | null;
  knowledgeSources: AgentTestKnowledgeSource[];
  skillSlugs: string[];
}) {
  const definition = getAgentDefinition(input.agentType);
  if (!definition) throw new Error("Unsupported Agent type.");

  const [model, prompt, activeSkills] = await Promise.all([
    input.modelConfigId
      ? resolveModelConfigById(input.userId, input.modelConfigId)
      : resolveModelConfig(input.userId, input.agentType),
    resolveAgentTestPrompt(input.supabase, input.agentType),
    resolveActiveAgentSkills(input.supabase, input.agentType),
  ]);
  if (model.provider !== "openai") throw new Error("当前测试只支持 OpenAI 模型。");

  const selectedSlugs = new Set(input.skillSlugs);
  const selectedSkills = activeSkills.filter((skill) => selectedSlugs.has(skill.slug));
  const knowledge = new Set(input.knowledgeSources);
  const customPrompt = input.promptOverride?.trim() || null;
  const result = await runSugarAgent({
    agentType: input.agentType,
    agentName: `${definition.name} · 测试`,
    workflowName: `Sugar Agent Test · ${definition.name}`,
    message: input.message,
    history: [],
    model: model.model,
    apiKey: model.apiKey,
    instructions: `${customPrompt ?? prompt.instructions}${buildFullSkillInstructions(selectedSkills)}\n\n你正在只读测试环境中。可以读取被启用的知识，但不得写入飞书、修改代码、生成图片、询价、保存业务数据或执行其他有副作用的动作。`,
    includeProjectContextTool: knowledge.has("project_context"),
    includeKnowledgeTool: knowledge.has("project_knowledge"),
    includeAgentGeneralKnowledgeTool: knowledge.has("agent_general_knowledge"),
    includeFeishuWriteTool: false,
    includeResponseStyle: true,
    maxTurns: 6,
    projectContext: {
      supabase: input.supabase,
      userId: input.userId,
      projectId: input.projectId,
    },
  });

  return {
    reply: result.reply,
    toolCalls: result.toolCalls,
    loadedSkills: selectedSkills.map((skill) => skill.slug),
    traceId: result.traceId,
    model: { provider: model.provider, model: model.model },
    prompt: customPrompt
      ? { source: "test_override" as const, version: null }
      : { source: prompt.source, version: prompt.version },
  };
}
