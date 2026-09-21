import "server-only";

import { createAdminClient } from "../supabase/admin";
import type { GitWorkingTreeEntry, RepositoryStatus } from "../git/provider";
import type { CodingRunResult, CodingRunView } from "./types";
import { engineeringTaskSchema } from "./engineering-task";

function mapWorkingTree(value: unknown): GitWorkingTreeEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.path !== "string") return [];
    return [{
      path: row.path,
      indexStatus: typeof row.indexStatus === "string" ? row.indexStatus : " ",
      workTreeStatus: typeof row.workTreeStatus === "string" ? row.workTreeStatus : " ",
      conflicted: row.conflicted === true,
    }];
  });
}

export function mapCodingRun(row: Record<string, unknown>): CodingRunView {
  const executionRequest = engineeringTaskSchema.safeParse(row.execution_request);
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    repositoryId: String(row.repository_id),
    handoffTaskId: row.handoff_task_id ? String(row.handoff_task_id) : null,
    sourceKind: row.source_kind === "niuniu_conversation" ? "niuniu_conversation" : "xiaohua_handoff",
    sourceThreadId: row.source_thread_id ? String(row.source_thread_id) : null,
    sourceMessageId: row.source_message_id ? String(row.source_message_id) : null,
    executionRequest: executionRequest.success ? executionRequest.data : {
      title: String(row.task_summary || "工程任务"),
      instruction: String(row.task_summary || "执行已确认的工程任务"),
      background: "",
      requirements: [],
      constraints: [],
      unchangedScope: [],
      acceptanceCriteria: [],
      sourcePlanVersion: null,
    },
    userId: String(row.user_id),
    status: row.status as CodingRunView["status"],
    executionMode: "local_repository",
    localRepositoryPath: String(row.local_repository_path || ""),
    baseBranch: String(row.base_branch),
    workingBranch: String(row.working_branch),
    codexThreadId: row.codex_thread_id ? String(row.codex_thread_id) : null,
    executionAttempt: Number(row.execution_attempt),
    changeSummary: row.change_summary ? String(row.change_summary) : null,
    implementationSummary: row.implementation_summary ? String(row.implementation_summary) : null,
    changedFiles: Array.isArray(row.changed_files) ? row.changed_files.map(String) : [],
    fileSummaries: Array.isArray(row.file_summaries)
      ? row.file_summaries.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const value = item as Record<string, unknown>;
          return typeof value.path === "string" && typeof value.summary === "string"
            ? [{ path: value.path, summary: value.summary }]
            : [];
        })
      : [],
    diffSummary: row.diff_summary ? String(row.diff_summary) : null,
    gitDiff: row.git_diff ? String(row.git_diff) : null,
    testResult: (row.test_result ?? { status: "not_run", commands: [] }) as CodingRunView["testResult"],
    unresolvedItems: Array.isArray(row.unresolved_items) ? row.unresolved_items.map(String) : [],
    riskNotes: Array.isArray(row.risk_notes) ? row.risk_notes.map(String) : [],
    errorMessage: row.error_message ? String(row.error_message) : null,
    pullRequestNumber: row.pull_request_number ? Number(row.pull_request_number) : null,
    pullRequestUrl: row.pull_request_url ? String(row.pull_request_url) : null,
    pullRequestState: row.pull_request_state as CodingRunView["pullRequestState"],
    branchBefore: row.branch_before ? String(row.branch_before) : null,
    headBefore: row.head_before ? String(row.head_before) : null,
    workingTreeBefore: mapWorkingTree(row.working_tree_before),
    branchAfter: row.branch_after ? String(row.branch_after) : null,
    headAfter: row.head_after ? String(row.head_after) : null,
    workingTreeAfter: mapWorkingTree(row.working_tree_after),
    commitSha: row.commit_sha ? String(row.commit_sha) : null,
    pushStatus: (row.push_status || "not_requested") as CodingRunView["pushStatus"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function recordRunStarted(run: CodingRunView, actorName: string, repositoryStatus: RepositoryStatus) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("coding_runs").update({
    status: "running",
    execution_attempt: run.executionAttempt + 1,
    error_message: null,
    branch_before: repositoryStatus.currentBranch,
    head_before: repositoryStatus.headCommit,
    working_tree_before: repositoryStatus.changes,
    local_repository_path: repositoryStatus.localRepositoryPath,
    started_at: new Date().toISOString(),
  }).eq("id", run.id).eq("status", run.status).select("id").maybeSingle();
  if (error || !data) throw new Error("Unable to start coding run.");
  await admin.from("project_activities").insert({
    project_id: run.projectId,
    user_id: run.userId,
    event_type: "coding_run_started",
    actor_type: "user",
    actor: actorName,
    summary: `启动了工程执行：${run.workingBranch}`,
    related_entity_id: run.id,
  });
}

export async function recordRunCompleted(run: CodingRunView, result: CodingRunResult) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("coding_runs").update({
    status: "completed",
    codex_thread_id: result.codexThreadId,
    change_summary: result.changeSummary,
    implementation_summary: result.implementationSummary,
    result_summary: result.implementationSummary,
    changed_files: result.changedFiles,
    file_summaries: result.fileSummaries,
    diff_summary: result.diffSummary,
    git_diff: result.gitDiff,
    test_result: result.testResult,
    unresolved_items: result.unresolvedItems,
    risk_notes: result.riskNotes,
    head_commit_sha: result.headCommitSha,
    branch_before: result.branchBefore,
    head_before: result.headBefore,
    working_tree_before: result.workingTreeBefore,
    branch_after: result.branchAfter,
    head_after: result.headAfter,
    working_tree_after: result.workingTreeAfter,
    commit_sha: result.commitSha,
    push_status: result.pushStatus,
    error_message: null,
    completed_at: new Date().toISOString(),
  }).eq("id", run.id).eq("status", "running").select("id").maybeSingle();
  if (error || !data) throw new Error("Unable to save coding result.");
  await admin.from("project_activities").insert({
    project_id: run.projectId,
    user_id: run.userId,
    event_type: "coding_run_completed",
    actor_type: "agent",
    actor: "Codex（通过工程师牛牛）",
    summary: `Codex 执行完成并保存到本地：${result.changedFiles.length} 个文件，测试${result.testResult.status === "passed" ? "通过" : result.testResult.status === "failed" ? "失败" : "未运行"}`,
    related_entity_id: run.id,
  });
}

export async function recordRunFailed(run: CodingRunView, safeMessage: string) {
  const admin = createAdminClient();
  await admin.from("coding_runs").update({
    status: "failed",
    error_message: safeMessage.slice(0, 1000),
    error_summary: safeMessage.slice(0, 1000),
    completed_at: new Date().toISOString(),
  }).eq("id", run.id);
  await admin.from("project_activities").insert({
    project_id: run.projectId,
    user_id: run.userId,
    event_type: "coding_run_failed",
    actor_type: "agent",
    actor: "Codex（通过工程师牛牛）",
    summary: "Codex 工程执行或本地保存失败；未自动上传远端",
    related_entity_id: run.id,
  });
}
