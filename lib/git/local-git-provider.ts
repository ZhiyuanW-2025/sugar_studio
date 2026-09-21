import "server-only";

import type {
  GitAction,
  GitActionResult,
  GitProvider,
  RepositoryBinding,
  RepositoryStatus,
} from "./provider";
import { GitProviderError } from "./provider";
import { requestUserRunner, UserRunnerError, type RunnerPath } from "../runner/dispatch";

async function runnerRequest<T>(userId: string, path: RunnerPath, body: unknown): Promise<T> {
  try {
    return await requestUserRunner<T>({ userId, path, body, timeoutMs: 300_000 });
  } catch (error) {
    if (!(error instanceof UserRunnerError)) throw error;
    const code = error.code as GitProviderError["code"] | undefined;
    throw new GitProviderError(
      code || "invalid_response",
      error.safeMessage || "Sugar Runner 返回了无效响应。",
      error.details,
    );
  }
}

async function runAction(
  userId: string,
  repository: RepositoryBinding,
  action: GitAction,
  confirmed: boolean,
  commitMessage?: string,
  commitPaths?: string[],
): Promise<GitActionResult> {
  if (!confirmed) {
    throw new GitProviderError("confirmation_required", `${action} 操作需要用户明确确认。`);
  }
  const payload = await runnerRequest<{ result: GitActionResult }>(userId, "/v1/repositories/action", {
    repository,
    action,
    confirmed,
    commitMessage,
    commitPaths,
  });
  return payload.result;
}

export class LocalGitProvider implements GitProvider {
  constructor(private readonly userId: string) {}

  async getRepositoryStatus(repository: RepositoryBinding) {
    const payload = await runnerRequest<{ status: RepositoryStatus }>(this.userId, "/v1/repositories/inspect", { repository });
    return payload.status;
  }

  async getCurrentBranch(repository: RepositoryBinding) {
    return (await this.getRepositoryStatus(repository)).currentBranch;
  }

  async getDiff(repository: RepositoryBinding) {
    const payload = await runnerRequest<{ summary: string; diff: string }>(this.userId, "/v1/repositories/diff", { repository });
    return { summary: payload.summary, diff: payload.diff };
  }

  commitChanges(repository: RepositoryBinding, message: string, confirmed: boolean, paths?: string[]) {
    return runAction(this.userId, repository, "commit", confirmed, message, paths);
  }

  fetchRemote(repository: RepositoryBinding, confirmed: boolean) {
    return runAction(this.userId, repository, "fetch", confirmed);
  }

  pullRemote(repository: RepositoryBinding, confirmed: boolean) {
    return runAction(this.userId, repository, "pull", confirmed);
  }

  syncDefaultBranch(repository: RepositoryBinding, confirmed: boolean) {
    return runAction(this.userId, repository, "sync", confirmed);
  }

  pushRemote(repository: RepositoryBinding, confirmed: boolean) {
    return runAction(this.userId, repository, "push", confirmed);
  }
}

export function getLocalGitProvider(userId: string) {
  return new LocalGitProvider(userId);
}
