import { createAgentMessageHandlers } from "../../../../../lib/agents/message-route";
import { procurementAgentInstructions, runProcurementAgent } from "../../../../../lib/agents/procurement-agent";
import { NewtonApiError } from "../../../../../lib/newton/server";

export const dynamic = "force-dynamic";

function findNewtonError(error: unknown): NewtonApiError | undefined {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (current instanceof NewtonApiError) return current;
    if (!current || typeof current !== "object") return undefined;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

const handlers = createAgentMessageHandlers({
  agentType: "procurement",
  errorLabel: "金牌买手拉夫",
  fallbackInstructions: procurementAgentInstructions,
  run: runProcurementAgent,
  mapRunError(error) {
    const newtonError = findNewtonError(error);
    if (!newtonError) return undefined;
    if (newtonError.code === "NEWTON_NOT_CONFIGURED") return { message: newtonError.message, status: 503 };
    if (newtonError.code === "NEWTON_WAIT_USER" || newtonError.code === "INVALID_REQUIREMENT") return { message: newtonError.message, status: 422 };
    if (newtonError.code?.startsWith("RATE_LIMIT_") || newtonError.retryable) return { message: newtonError.message, status: 503 };
    return { message: newtonError.message, status: 502 };
  },
});

export const GET = handlers.GET;
export const POST = handlers.POST;
