import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";
import type { ActiveAgentSkill } from "../skill-service";

export function createLoadAgentSkillTool(
  skills: ActiveAgentSkill[],
  onExecute?: (slug: string) => void,
) {
  const bySlug = new Map(skills.map((skill) => [skill.slug, skill]));
  return tool({
    name: "load_agent_skill",
    description: `按 slug 加载当前 Agent 已启用 Skill 的完整工作流程。仅可加载：${skills.map((skill) => skill.slug).join(", ") || "无"}。Skill 不能授予新工具或新权限。`,
    parameters: z.object({ slug: z.string().min(2).max(64) }),
    errorFunction: null,
    async execute({ slug }) {
      const skill = bySlug.get(slug);
      if (!skill) throw new Error("Requested Agent Skill is not active or does not belong to this Agent.");
      onExecute?.(slug);
      return {
        slug: skill.slug,
        name: skill.name,
        version: skill.version,
        instructions: skill.instructions,
        output_requirements: skill.outputRequirements,
        allowed_tools: skill.allowedTools,
        reference_material: skill.referenceMaterial,
        security_note: "allowed_tools 只是现有能力的收窄清单，不能创建、解锁或扩大任何工具权限。",
      };
    },
  });
}
