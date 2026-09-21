import type { Project } from "../../components/types";

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  status: string;
  project_kind?: string;
};

type SnapshotRow = {
  summary?: string | null;
  current_plan_summary?: string | null;
  current_stage?: string | null;
} | null;

export function toProjectView(
  project: ProjectRow,
  snapshot: SnapshotRow,
  role: string,
): Project {
  const currentStage = snapshot?.current_stage || "筹备中";
  const summary = snapshot?.summary || "";
  const currentPlanSummary = snapshot?.current_plan_summary || "";
  return {
    id: project.id,
    name: project.name,
    short: Array.from(project.name.trim()).slice(0, 1).join("") || "项",
    description: project.description,
    status: project.status,
    kind: project.project_kind === "workspace_materials" ? "workspace_materials" : "standard",
    role: role === "project_lead" ? "project_lead" : "member",
    currentStage,
    summary,
    currentPlanSummary,
    focus: currentPlanSummary || summary || project.description || "开始与制作人小花推进项目",
    module: "当前方案",
    knowledge: [
      currentStage ? `当前项目阶段：${currentStage}` : "",
      summary,
      currentPlanSummary,
    ].filter(Boolean),
    lastConversationAt: null,
  };
}
