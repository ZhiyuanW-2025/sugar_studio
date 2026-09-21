import type { ModelAgentType } from "../model-config/catalog";
import { validateAgentSkillTools } from "./skill-catalog";

export type AgentSkillDefinitionInput = {
  name: string;
  description: string;
  triggerDescription: string;
  negativeTriggers: string;
  instructions: string;
  outputRequirements: string;
  allowedTools: string[];
  referenceMaterial: string;
  testCases: { shouldTrigger: string[]; shouldNotTrigger: string[] };
  status: "draft" | "active" | "disabled";
};

const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length <= max ? value.trim() : null;
const examples = (value: unknown) => Array.isArray(value) && value.length <= 20 && value.every((item) => typeof item === "string" && item.trim().length <= 500)
  ? value.map((item) => item.trim()).filter(Boolean)
  : null;

export function parseAgentSkillDefinition(agentType: ModelAgentType, body: Record<string, unknown> | null): AgentSkillDefinitionInput | null {
  if (!body) return null;
  const name = text(body.name, 80);
  const description = text(body.description, 500);
  const triggerDescription = text(body.triggerDescription, 2000);
  const negativeTriggers = text(body.negativeTriggers ?? "", 2000);
  const instructions = text(body.instructions, 20000);
  const outputRequirements = text(body.outputRequirements ?? "", 8000);
  const referenceMaterial = text(body.referenceMaterial ?? "", 20000);
  const allowedTools = validateAgentSkillTools(agentType, body.allowedTools);
  const rawTests = body.testCases && typeof body.testCases === "object" ? body.testCases as Record<string, unknown> : {};
  const shouldTrigger = examples(rawTests.shouldTrigger ?? []);
  const shouldNotTrigger = examples(rawTests.shouldNotTrigger ?? []);
  const status = ["draft", "active", "disabled"].includes(String(body.status)) ? body.status as AgentSkillDefinitionInput["status"] : null;
  if (!name || !description || !triggerDescription || !instructions || negativeTriggers === null || outputRequirements === null || referenceMaterial === null || !allowedTools || !shouldTrigger || !shouldNotTrigger || !status) return null;
  return { name, description, triggerDescription, negativeTriggers, instructions, outputRequirements, allowedTools, referenceMaterial, testCases: { shouldTrigger, shouldNotTrigger }, status };
}

export const skillTestCasesToDb = (tests: AgentSkillDefinitionInput["testCases"]) => ({
  should_trigger: tests.shouldTrigger,
  should_not_trigger: tests.shouldNotTrigger,
});
