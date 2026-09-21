export type RepositoryProvider = "local_git" | "github" | "gitlab" | "gitea" | "self_hosted";

export type GitWorkingTreeEntry = {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  conflicted: boolean;
};

export type GitCommitSummary = {
  sha: string;
  message: string;
};

export type RepositoryStatus = {
  repositoryName: string;
  localRepositoryPath: string;
  currentBranch: string;
  headCommit: string;
  headMessage: string;
  remoteName: string;
  remoteUrl: string | null;
  availableRemotes: string[];
  defaultBranch: string | null;
  upstream: string | null;
  clean: boolean;
  ahead: number;
  behind: number;
  changes: GitWorkingTreeEntry[];
  conflicts: string[];
  commitsToPush: GitCommitSummary[];
};

export type RepositoryBinding = {
  id: string;
  projectId: string;
  provider: RepositoryProvider;
  localRepositoryPath: string;
  remoteName: string;
  remoteUrl: string | null;
  currentBranch: string;
  defaultBranch: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GitAction = "fetch" | "pull" | "sync" | "push" | "commit";

export type GitActionResult = {
  action: GitAction;
  success: boolean;
  message: string;
  status: RepositoryStatus;
  commitSha?: string;
  committedFiles?: string[];
};

export interface GitProvider {
  getRepositoryStatus(repository: RepositoryBinding): Promise<RepositoryStatus>;
  getCurrentBranch(repository: RepositoryBinding): Promise<string>;
  getDiff(repository: RepositoryBinding): Promise<{ summary: string; diff: string }>;
  commitChanges(repository: RepositoryBinding, message: string, confirmed: boolean, paths?: string[]): Promise<GitActionResult>;
  fetchRemote(repository: RepositoryBinding, confirmed: boolean): Promise<GitActionResult>;
  pullRemote(repository: RepositoryBinding, confirmed: boolean): Promise<GitActionResult>;
  syncDefaultBranch(repository: RepositoryBinding, confirmed: boolean): Promise<GitActionResult>;
  pushRemote(repository: RepositoryBinding, confirmed: boolean): Promise<GitActionResult>;
}

export class GitProviderError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "forbidden"
      | "conflict"
      | "invalid_repository"
      | "invalid_response"
      | "runner_required"
      | "runner_unavailable"
      | "confirmation_required"
      | "dirty_worktree"
      | "high_risk_operation",
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
