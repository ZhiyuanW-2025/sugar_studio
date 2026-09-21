import "server-only";

import { tool } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const noParameters = z.object({});

const projectContextSchema = z.object({
  project_id: z.string().uuid(),
  project_name: z.string(),
  description: z.string(),
  status: z.string(),
  current_stage: z.string().nullable(),
  summary: z.string().nullable(),
  current_plan_summary: z.string().nullable(),
});

export type ProjectContext = z.infer<typeof projectContextSchema>;

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  status: string;
};

type ProjectSnapshotRow = {
  current_stage: string;
  summary: string;
  current_plan_summary: string;
};

type ProjectContextAccess = {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
};

/**
 * Loads the official project overview through the signed-in user's Supabase
 * session. The explicit membership check is defense in depth on top of RLS.
 */
export async function loadProjectContext({
  supabase,
  userId,
  projectId,
}: ProjectContextAccess): Promise<ProjectContext> {
  const { data: membership, error: membershipError } = await supabase
    .from("project_members")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError || !membership) {
    throw new Error("Project context access denied.");
  }

  const [{ data: project, error: projectError }, { data: snapshot, error: snapshotError }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, description, status")
        .eq("id", projectId)
        .maybeSingle(),
      supabase
        .from("project_snapshots")
        .select("current_stage, summary, current_plan_summary")
        .eq("project_id", projectId)
        .maybeSingle(),
    ]);

  if (projectError || !project || snapshotError) {
    throw new Error("Project context lookup failed.");
  }

  const projectRow = project as ProjectRow;
  const snapshotRow = snapshot as ProjectSnapshotRow | null;

  return {
    project_id: projectRow.id,
    project_name: projectRow.name,
    description: projectRow.description,
    status: projectRow.status,
    current_stage: snapshotRow?.current_stage ?? null,
    summary: snapshotRow?.summary ?? null,
    current_plan_summary: snapshotRow?.current_plan_summary ?? null,
  };
}

export function createGetProjectContextTool(
  access: ProjectContextAccess & { onExecute?: () => void },
) {
  return tool({
    name: "get_project_context",
    description:
      "读取当前请求所绑定项目的正式结构化概况，包括项目名称、描述、状态、当前阶段、摘要和当前方案摘要。涉及当前项目事实、正式方案或阶段时使用。它不能读取项目文件，也不能选择其他项目。",
    parameters: noParameters,
    outputSchema: projectContextSchema,
    errorFunction: null,
    async execute() {
      const context = await loadProjectContext(access);
      access.onExecute?.();
      return context;
    },
  });
}
