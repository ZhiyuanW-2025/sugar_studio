import { codingAgentInstructions } from "../../../../../lib/agents/coding-agent";
import { runCodexDiscussion } from "../../../../../lib/agents/codex-discussion";
import { createAgentMessageHandlers } from "../../../../../lib/agents/message-route";
import { CodingRunnerError } from "../../../../../lib/coding-runs/runner-client";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

const SECRET_ENV_NAMES = [
  "OPENAI_API_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUGAR_CODEX_RUNNER_SECRET",
  "SUGAR_GITHUB_TOKEN",
  "FEISHU_APP_SECRET",
  "FEISHU_VERIFICATION_TOKEN",
] as const;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : null;
}

function redactSensitiveText(value: string, apiKey: string): string {
  const configuredSecrets = [
    apiKey,
    ...SECRET_ENV_NAMES.map((name) => process.env[name]),
  ].filter((secret): secret is string => Boolean(secret && secret.length >= 8));

  let redacted = value;

  for (const secret of configuredSecrets) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }

  return redacted
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/\bsb_secret_[A-Za-z0-9_-]+\b/g, "[REDACTED_SECRET]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|secret)\s*[=:]\s*)[^\s,;}]+/gi,
      "$1[REDACTED]",
    );
}

function readHttpStatus(error: UnknownRecord | null): number | string | undefined {
  const response = asRecord(error?.response);
  const candidate = error?.status ?? error?.statusCode ?? response?.status;

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  if (typeof candidate === "string" && /^\d{3}$/.test(candidate)) {
    return candidate;
  }

  return undefined;
}

function readErrorCode(error: UnknownRecord | null): string | number | undefined {
  const nestedError = asRecord(error?.error);
  const cause = asRecord(error?.cause);
  const candidate = error?.code ?? nestedError?.code ?? cause?.code;

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  if (
    typeof candidate === "string" &&
    candidate.length <= 120 &&
    /^[A-Za-z0-9_.:/-]+$/.test(candidate)
  ) {
    return candidate;
  }

  return undefined;
}

function logCodingAgentError(error: unknown, apiKey: string) {
  const errorRecord = asRecord(error);
  const errorCode = readErrorCode(errorRecord);
  const name =
    error instanceof Error
      ? error.name
      : typeof errorRecord?.name === "string"
        ? errorRecord.name
        : "UnknownError";
  const message =
    error instanceof Error
      ? error.message
      : typeof errorRecord?.message === "string"
        ? errorRecord.message
        : typeof error === "string"
          ? error
          : "Unknown coding agent failure.";
  const stack =
    error instanceof Error
      ? error.stack
      : typeof errorRecord?.stack === "string"
        ? errorRecord.stack
        : undefined;

  console.error("[Sugar Agent][coding] Agent run failed", {
    name: redactSensitiveText(name, apiKey).slice(0, 200),
    message: redactSensitiveText(message, apiKey).slice(0, 4_000),
    stack: stack
      ? redactSensitiveText(stack, apiKey).slice(0, 12_000)
      : undefined,
    httpStatus: readHttpStatus(errorRecord),
    code:
      typeof errorCode === "string"
        ? redactSensitiveText(errorCode, apiKey)
        : errorCode,
  });
}

const handlers = createAgentMessageHandlers({
  agentType: "coding",
  errorLabel: "工程师牛牛",
  fallbackInstructions: codingAgentInstructions,
  run: async (input) => {
    try {
      return await runCodexDiscussion(input);
    } catch (error) {
      logCodingAgentError(error, input.apiKey);
      throw error;
    }
  },
  mapRunError: (error) => error instanceof CodingRunnerError
    ? { message: error.safeMessage, status: 503 }
    : undefined,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
