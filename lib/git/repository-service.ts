import "server-only";

import path from "node:path";
import { z } from "zod";
import type { RepositoryBinding } from "./provider";

const remoteName = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/);

export const repositoryInputSchema = z.object({
  localRepositoryPath: z.string().trim().min(1).max(2048).refine(path.isAbsolute, "必须填写绝对路径"),
  remoteName: remoteName.default("origin"),
  remoteUrl: z.string().trim().max(2048).optional().default(""),
}).strict();

export function mapRepositoryRow(row: Record<string, unknown>, workspace?: Record<string, unknown> | null): RepositoryBinding {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    provider: String(row.provider || "local_git") as RepositoryBinding["provider"],
    localRepositoryPath: String(workspace?.local_repository_path || row.local_repository_path || ""),
    remoteName: String(workspace?.remote_name || row.remote_name || "origin"),
    remoteUrl: row.remote_url ? String(row.remote_url) : null,
    currentBranch: String(workspace?.current_branch || row.current_branch || ""),
    defaultBranch: row.default_branch ? String(row.default_branch) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
