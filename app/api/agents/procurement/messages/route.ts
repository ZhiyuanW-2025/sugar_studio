import { createAgentMessageHandlers } from "../../../../../lib/agents/message-route";
import { procurementAgentInstructions, runProcurementAgent } from "../../../../../lib/agents/procurement-agent";
import { findNewtonApiError, newtonErrorPublicDetails } from "../../../../../lib/newton/server";

export const dynamic = "force-dynamic";

function formatNewtonErrorMessage(message: string, code: string | null, traceId: string | null) {
  const references = [
    code ? `错误码：${code}` : null,
    traceId ? `1688 Trace ID：${traceId}` : null,
  ].filter((item): item is string => Boolean(item));
  return references.length > 0 ? `${message}（${references.join("；")}）` : message;
}

const handlers = createAgentMessageHandlers({
  agentType: "procurement",
  errorLabel: "金牌买手拉夫",
  fallbackInstructions: procurementAgentInstructions,
  run: runProcurementAgent,
  mapRunError(error) {
    const newtonError = findNewtonApiError(error);
    if (!newtonError) return undefined;
    const diagnostics = newtonErrorPublicDetails(newtonError);
    console.error("[procurement] 1688 request failed", diagnostics);
    const message = formatNewtonErrorMessage(newtonError.message, newtonError.code, newtonError.traceId);
    const details = { integrationError: diagnostics };
    if (newtonError.code === "NEWTON_NOT_CONFIGURED") return { message, status: 503, details };
    if (newtonError.code === "NEWTON_WAIT_USER" || newtonError.code === "INVALID_REQUIREMENT") return { message, status: 422, details };
    if (newtonError.code?.startsWith("RATE_LIMIT_") || newtonError.retryable) return { message, status: 503, details };
    return { message, status: 502, details };
  },
});

export const GET = handlers.GET;
export const POST = handlers.POST;
