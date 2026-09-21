import "server-only";

import { createAdminClient } from "../supabase/admin";

export class UserRunnerError extends Error {
  constructor(
    public readonly safeMessage: string,
    public readonly code = "runner_error",
    public readonly details?: unknown,
  ) {
    super(safeMessage);
  }
}

export type RunnerPath =
  | "/v1/repositories/inspect"
  | "/v1/repositories/diff"
  | "/v1/repositories/action"
  | "/v1/codex/discuss"
  | "/v1/coding-runs/execute";

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function stripSecrets(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const safe = { ...(body as Record<string, unknown>) };
  delete safe.apiKey;
  return safe;
}

async function directRequest<T>(path: RunnerPath, body: unknown): Promise<T> {
  const url = process.env.SUGAR_CODEX_RUNNER_URL?.trim();
  const secret = process.env.SUGAR_CODEX_RUNNER_SECRET?.trim();
  if (!url || !secret) throw new UserRunnerError("Sugar Runner 尚未连接。", "runner_required");
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new UserRunnerError("无法连接 Sugar Runner，请确认本地助手正在运行。", "runner_unavailable");
  }
  const payload = await response.json().catch(() => null) as (T & { error?: string; code?: string; details?: unknown }) | null;
  if (!response.ok || !payload) {
    throw new UserRunnerError(payload?.error || "Sugar Runner 返回了无效响应。", payload?.code || "invalid_response", payload?.details);
  }
  return payload;
}

async function deviceRequest<T>(userId: string, path: RunnerPath, body: unknown, timeoutMs: number): Promise<T> {
  const admin = createAdminClient();
  const onlineCutoff = new Date(Date.now() - 120_000).toISOString();
  const { data: device } = await admin.from("runner_devices")
    .select("id,name,last_seen_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .gte("last_seen_at", onlineCutoff)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!device) {
    throw new UserRunnerError("Sugar Runner 未在线。请在账户设置中完成配对，并保持本地助手运行。", "runner_offline");
  }

  const expiresAt = new Date(Date.now() + timeoutMs + 30_000).toISOString();
  const { data: job, error } = await admin.from("runner_jobs").insert({
    user_id: userId,
    device_id: device.id,
    request_path: path,
    request_body: stripSecrets(body),
    expires_at: expiresAt,
  }).select("id").single();
  if (error || !job) throw new UserRunnerError("暂时无法把任务发送到 Sugar Runner。", "runner_queue_failed");

  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    const { data: current } = await admin.from("runner_jobs")
      .select("status,response_body,response_status,error_code,error_message")
      .eq("id", job.id).eq("user_id", userId).maybeSingle();
    if (!current) throw new UserRunnerError("Sugar Runner 任务不存在。", "runner_job_missing");
    if (current.status === "succeeded") return current.response_body as T;
    if (["failed", "expired"].includes(current.status)) {
      const payload = current.response_body as { error?: string; code?: string; details?: unknown } | null;
      throw new UserRunnerError(
        payload?.error || current.error_message || "Sugar Runner 执行失败。",
        payload?.code || current.error_code || "runner_error",
        payload?.details,
      );
    }
    const elapsed = Date.now() - startedAt;
    await delay(elapsed < 3_000 ? 450 : elapsed < 20_000 ? 2_000 : 10_000);
  }

  await admin.from("runner_jobs").update({
    status: "expired",
    completed_at: new Date().toISOString(),
    error_code: "runner_timeout",
    error_message: "Sugar Runner did not finish before the request timeout.",
  }).eq("id", job.id).in("status", ["queued", "running"]);
  throw new UserRunnerError("Sugar Runner 本次执行超时，请确认电脑未休眠后重试。", "runner_timeout");
}

export async function requestUserRunner<T>(input: {
  userId: string;
  path: RunnerPath;
  body: unknown;
  timeoutMs?: number;
}): Promise<T> {
  const transport = process.env.SUGAR_RUNNER_TRANSPORT?.trim().toLowerCase() || "auto";
  const hasDirectRunner = Boolean(process.env.SUGAR_CODEX_RUNNER_URL?.trim() && process.env.SUGAR_CODEX_RUNNER_SECRET?.trim());
  if (transport === "direct" || (transport === "auto" && hasDirectRunner && process.env.NODE_ENV !== "production")) {
    return directRequest<T>(input.path, input.body);
  }
  return deviceRequest<T>(input.userId, input.path, input.body, input.timeoutMs ?? 300_000);
}
