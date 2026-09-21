import { designAgentInstructions, runDesignAgent } from "../../../../../lib/agents/design-agent";
import { createAgentMessageHandlers } from "../../../../../lib/agents/message-route";

export const dynamic = "force-dynamic";

const handlers = createAgentMessageHandlers({
  agentType: "design",
  errorLabel: "艺术家小熊",
  fallbackInstructions: designAgentInstructions,
  run: runDesignAgent,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
