export const progressCategories = ["decision", "material", "execution", "external", "management", "exception"] as const;
export type ProgressCategory = typeof progressCategories[number];
export type ProgressStatus = "completed" | "failed";

export const progressCategoryLabels: Record<ProgressCategory, string> = {
  decision: "方案与决策",
  material: "成果与材料",
  execution: "执行记录",
  external: "对外工作",
  management: "项目管理",
  exception: "异常",
};

export const visibleProjectProgressEventTypes = [
  "manual_progress",
  "plan_version_saved",
  "plan_version_rolled_back",
  "project_context_updated",
  "project_file_uploaded",
  "project_file_version_uploaded",
  "project_file_deleted",
  "project_file_moved_out",
  "repository_bound",
  "coding_run_completed",
  "coding_run_failed",
  "git_commit",
  "git_push",
  "design_image_generated",
  "design_image_approved",
  "design_image_approval_revoked",
  "handoff_task_delivered",
  "collaboration_task_delivered",
  "client_deliverable_approved",
  "client_deliverable_dispatched",
  "procurement_inquiry_sent",
  "procurement_follow_up_sent",
  "project_created",
  "project_member_added",
  "project_member_role_updated",
  "project_member_removed",
] as const;

export function progressCategoryForEvent(eventType: string): ProgressCategory {
  if (["plan_version_saved", "plan_version_rolled_back", "project_context_updated"].includes(eventType)) return "decision";
  if (["project_file_uploaded", "project_file_version_uploaded", "project_file_deleted", "project_file_moved_out", "design_image_generated", "design_image_approved", "design_image_approval_revoked", "client_deliverable_approved"].includes(eventType)) return "material";
  if (["repository_bound", "coding_run_completed", "git_commit", "git_push", "handoff_task_delivered", "collaboration_task_delivered"].includes(eventType)) return "execution";
  if (["client_deliverable_dispatched", "procurement_inquiry_sent", "procurement_follow_up_sent"].includes(eventType)) return "external";
  if (eventType === "coding_run_failed") return "exception";
  return "management";
}
