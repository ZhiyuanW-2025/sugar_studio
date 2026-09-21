import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelAgentType } from "../model-config/catalog";

export type ActiveAgentSkill = {
  id: string;
  slug: string;
  version: number;
  name: string;
  description: string;
  triggerDescription: string;
  negativeTriggers: string;
  instructions: string;
  outputRequirements: string;
  allowedTools: string[];
  referenceMaterial: string;
};

export async function resolveActiveAgentSkills(
  supabase: SupabaseClient,
  agentType: ModelAgentType,
): Promise<ActiveAgentSkill[]> {
  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id")
    .eq("agent_type", agentType)
    .maybeSingle();
  if (agentError || !agent) return [];

  const { data: skills, error: skillError } = await supabase
    .from("agent_skills")
    .select("id,slug")
    .eq("agent_id", agent.id)
    .eq("status", "active")
    .order("slug");
  if (skillError || !skills?.length) return [];

  const { data: versions, error: versionError } = await supabase
    .from("agent_skill_versions")
    .select("skill_id,version,name,description,trigger_description,negative_triggers,instructions,output_requirements,allowed_tools,reference_material")
    .in("skill_id", skills.map((skill) => skill.id))
    .eq("is_active", true);
  if (versionError) return [];
  const bySkill = new Map((versions ?? []).map((version) => [version.skill_id, version]));
  return skills.flatMap((skill) => {
    const version = bySkill.get(skill.id);
    return version ? [{
      id: skill.id,
      slug: skill.slug,
      version: version.version,
      name: version.name,
      description: version.description,
      triggerDescription: version.trigger_description,
      negativeTriggers: version.negative_triggers,
      instructions: version.instructions,
      outputRequirements: version.output_requirements,
      allowedTools: version.allowed_tools ?? [],
      referenceMaterial: version.reference_material,
    }] : [];
  });
}

export function buildSkillMetadataInstructions(skills: ActiveAgentSkill[]) {
  if (!skills.length) return "";
  const catalog = skills.map((skill) => [
    `- ${skill.slug}（${skill.name}，v${skill.version}）`,
    `  用途：${skill.description}`,
    `  应使用：${skill.triggerDescription}`,
    skill.negativeTriggers ? `  不应使用：${skill.negativeTriggers}` : "",
  ].filter(Boolean).join("\n")).join("\n");
  return `\n\n你拥有以下已启用的工作 Skill。它们是可按需加载的工作方法，不是新的权限。先根据用户目标判断是否需要；需要时调用 load_agent_skill(slug) 读取完整流程后再执行。不要为了展示能力而强行调用。\n${catalog}`;
}

export function buildFullSkillInstructions(skills: ActiveAgentSkill[]) {
  if (!skills.length) return "";
  return `\n\n当前已启用的 Agent Skills：\n${skills.map((skill) => `## ${skill.name} (${skill.slug}, v${skill.version})\n触发：${skill.triggerDescription}\n不触发：${skill.negativeTriggers || "无"}\n工作流程：\n${skill.instructions}\n输出要求：\n${skill.outputRequirements || "无额外要求"}\n可用工具范围：${skill.allowedTools.join(", ") || "无"}\n参考：\n${skill.referenceMaterial || "无"}`).join("\n\n")}`;
}
