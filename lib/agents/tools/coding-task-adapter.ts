import "server-only";

import type { CodingRunView } from "../../coding-runs/types";
import { invokeCodexRunner } from "../../coding-runs/runner-client";
import type { RepositoryBinding } from "../../git/provider";
import type { EngineeringTask } from "../../coding-runs/engineering-task";

export type CodingTaskRequest = {
  run: CodingRunView;
  repository: RepositoryBinding;
  task: EngineeringTask;
  instructions: string;
  continuation?: string;
  model: string;
  apiKey: string;
  allowDirtyWorkingTree: boolean;
};

/**
 * Server-only boundary used by 牛牛 after a user explicitly starts a Coding
 * Run. The trusted local runner constrains Codex to the bound repository.
 */
export async function runCodingTask(request: CodingTaskRequest) {
  return invokeCodexRunner(request);
}
