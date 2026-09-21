import type { EngineeringTask } from "./engineering-task";
import type { GitWorkingTreeEntry } from "../git/provider";

export type CodingRunStatus = "pending" | "running" | "completed" | "failed" | "awaiting_review" | "merged";

export type TestCommandResult = {
  command: string;
  status: "passed" | "failed" | "not_run";
  exitCode: number | null;
  output: string;
};

export type CodingRunResult = {
  codexThreadId: string;
  changeSummary: string;
  implementationSummary: string;
  changedFiles: string[];
  fileSummaries: Array<{ path: string; summary: string }>;
  diffSummary: string;
  gitDiff: string;
  testResult: {
    status: "passed" | "failed" | "not_run";
    commands: TestCommandResult[];
  };
  unresolvedItems: string[];
  riskNotes: string[];
  headCommitSha: string;
  branchBefore: string;
  headBefore: string;
  workingTreeBefore: GitWorkingTreeEntry[];
  branchAfter: string;
  headAfter: string;
  workingTreeAfter: GitWorkingTreeEntry[];
  commitSha: string | null;
  pushStatus: "not_requested" | "pending_confirmation" | "succeeded" | "failed";
};

export type CodingRunView = {
  id: string;
  projectId: string;
  repositoryId: string;
  handoffTaskId: string | null;
  sourceKind: "xiaohua_handoff" | "niuniu_conversation";
  sourceThreadId: string | null;
  sourceMessageId: string | null;
  executionRequest: EngineeringTask;
  userId: string;
  status: CodingRunStatus;
  executionMode: "local_repository";
  localRepositoryPath: string;
  baseBranch: string;
  workingBranch: string;
  codexThreadId: string | null;
  executionAttempt: number;
  changeSummary: string | null;
  implementationSummary: string | null;
  changedFiles: string[];
  fileSummaries: Array<{ path: string; summary: string }>;
  diffSummary: string | null;
  gitDiff: string | null;
  testResult: CodingRunResult["testResult"];
  unresolvedItems: string[];
  riskNotes: string[];
  errorMessage: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  pullRequestState: "open" | "closed" | "merged" | null;
  branchBefore: string | null;
  headBefore: string | null;
  workingTreeBefore: GitWorkingTreeEntry[];
  branchAfter: string | null;
  headAfter: string | null;
  workingTreeAfter: GitWorkingTreeEntry[];
  commitSha: string | null;
  pushStatus: CodingRunResult["pushStatus"];
  createdAt: string;
  updatedAt: string;
};

export type EngineeringTaskView = {
  id: string;
  title: string;
  task: EngineeringTask;
  sourceKind: "xiaohua_handoff" | "niuniu_conversation";
  deliveredAt: string | null;
  run: CodingRunView | null;
};
