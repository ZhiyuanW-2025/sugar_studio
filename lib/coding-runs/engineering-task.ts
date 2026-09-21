import { z } from "zod";
import type { TechnicalBrief } from "../handoffs/briefs";

const conciseText = z.string().trim().min(1).max(12_000);
const textList = z.array(z.string().trim().min(1).max(4_000)).max(30);

export const engineeringTaskSchema = z.object({
  title: z.string().trim().min(1).max(4_000),
  instruction: conciseText,
  background: z.string().trim().max(12_000).default(""),
  requirements: textList.default([]),
  constraints: textList.default([]),
  unchangedScope: textList.default([]),
  acceptanceCriteria: textList.default([]),
  sourcePlanVersion: z.string().nullable().default(null),
}).strict();

export type EngineeringTask = z.infer<typeof engineeringTaskSchema>;

export function engineeringTaskFromTechnicalBrief(brief: TechnicalBrief): EngineeringTask {
  return {
    title: brief.title,
    instruction: brief.goal,
    background: brief.background,
    requirements: brief.requirements,
    constraints: brief.constraints,
    unchangedScope: brief.unchanged_scope,
    acceptanceCriteria: brief.acceptance_criteria,
    sourcePlanVersion: brief.source_plan_version,
  };
}

export function engineeringTaskFromHandoff(input: {
  title: string;
  content: string;
  brief: unknown;
}): EngineeringTask | null {
  if (input.brief && typeof input.brief === "object") {
    const value = input.brief as Record<string, unknown>;
    const parsed = engineeringTaskSchema.safeParse({
      title: typeof value.title === "string" ? value.title : input.title,
      instruction: typeof value.goal === "string" ? value.goal : input.content,
      background: typeof value.background === "string" ? value.background : "",
      requirements: Array.isArray(value.requirements) ? value.requirements : [],
      constraints: Array.isArray(value.constraints) ? value.constraints : [],
      unchangedScope: Array.isArray(value.unchanged_scope) ? value.unchanged_scope : [],
      acceptanceCriteria: Array.isArray(value.acceptance_criteria) ? value.acceptance_criteria : [],
      sourcePlanVersion: typeof value.source_plan_version === "string" ? value.source_plan_version : null,
    });
    if (parsed.success) return parsed.data;
  }
  const parsed = engineeringTaskSchema.safeParse({
    title: input.title,
    instruction: input.content,
    background: "",
    requirements: [],
    constraints: [],
    unchangedScope: [],
    acceptanceCriteria: [],
    sourcePlanVersion: null,
  });
  return parsed.success ? parsed.data : null;
}
