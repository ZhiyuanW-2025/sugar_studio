import { z } from "zod";

const conciseText = z.string().trim().min(1).max(4_000);
const textList = z.array(conciseText).max(30);

export const technicalBriefSchema = z.object({
  title: conciseText,
  goal: conciseText,
  background: conciseText,
  requirements: textList,
  constraints: textList,
  unchanged_scope: textList,
  acceptance_criteria: textList,
  related_project: conciseText,
  source_plan_version: z.string().nullable(),
}).strict();

export const executableTechnicalBriefSchema = technicalBriefSchema.refine(
  (brief) => brief.requirements.length > 0 && brief.acceptance_criteria.length > 0,
  { message: "工程任务至少需要一项需求和一项验收标准。" },
);

export const visualBriefSchema = z.object({
  title: conciseText,
  goal: conciseText,
  usage: conciseText,
  content_requirements: textList,
  visual_direction: textList,
  required_elements: textList,
  forbidden_elements: textList,
  size_or_medium: conciseText,
  references: textList,
  related_project: conciseText,
  source_plan_version: z.string().nullable(),
}).strict();

export type TechnicalBrief = z.infer<typeof technicalBriefSchema>;
export type VisualBrief = z.infer<typeof visualBriefSchema>;
export type HandoffBrief = TechnicalBrief | VisualBrief;
export type HandoffBriefType = "technical" | "visual";

export function getHandoffBriefSchema(targetAgent: "coding" | "design") {
  return targetAgent === "coding" ? technicalBriefSchema : visualBriefSchema;
}

export function handoffBriefTypeForAgent(targetAgent: "coding" | "design"): HandoffBriefType {
  return targetAgent === "coding" ? "technical" : "visual";
}
