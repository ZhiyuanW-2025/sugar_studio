import "server-only";

import type { EngineeringTask } from "./engineering-task";
import type { RepositoryBinding } from "../git/provider";
import type { CodingRunResult, CodingRunView } from "./types";
import { requestUserRunner, UserRunnerError } from "../runner/dispatch";

export type CodexDiscussionResult = {
  reply: string;
  codexThreadId: string;
};

export class CodingRunnerError extends Error {
  constructor(
    public readonly safeMessage: string,
    public readonly code = "runner_error",
    public readonly details?: unknown,
  ) {
    super(safeMessage);
  }
}

export async function invokeCodexRunner(input: {
  run: CodingRunView;
  repository: RepositoryBinding;
  task: EngineeringTask;
  instructions: string;
  continuation?: string;
  model: string;
  apiKey: string;
  allowDirtyWorkingTree: boolean;
}): Promise<CodingRunResult> {
  try {
    const payload = await requestUserRunner<{ result: CodingRunResult }>({
      userId: input.run.userId,
      path: "/v1/coding-runs/execute",
      timeoutMs: 300_000,
      body: {
      run: input.run,
      repository: input.repository,
      task: input.task,
      instructions: input.instructions,
      continuation: input.continuation,
      model: input.model,
      apiKey: input.apiKey,
      allowDirtyWorkingTree: input.allowDirtyWorkingTree,
      },
    });
    if (!payload?.result) throw new CodingRunnerError("Codex runner 执行失败。", "invalid_response");
    return payload.result;
  } catch (error) {
    if (error instanceof CodingRunnerError) throw error;
    if (error instanceof UserRunnerError) {
    throw new CodingRunnerError(
        error.safeMessage,
        error.code,
        error.details,
    );
    }
    throw error;
  }
}

export async function invokeCodexDiscussion(input: {
  userId: string;
  repository: RepositoryBinding | null;
  message: string;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  instructions: string;
  codexThreadId: string | null;
  model: string;
  apiKey: string;
}): Promise<CodexDiscussionResult> {
  try {
    const payload = await requestUserRunner<{ result: CodexDiscussionResult }>({
      userId: input.userId,
      path: "/v1/codex/discuss",
      timeoutMs: 300_000,
      body: input,
    });
    if (!payload?.result) throw new CodingRunnerError("工程师牛牛暂时无法连接 Codex，请稍后重试。", "invalid_response");
    return payload.result;
  } catch (error) {
    if (error instanceof CodingRunnerError) throw error;
    if (!(error instanceof UserRunnerError)) throw error;
    const safeMessage = error.code === "invalid_response"
      ? "工程师牛牛暂时无法连接 Codex，请稍后重试。"
      : error.safeMessage || "Codex 讨论请求失败。";
    throw new CodingRunnerError(
      safeMessage,
      error.code,
      error.details,
    );
  }
}
