import { clientAgentInstructions, runClientAgent } from "../../../../../lib/agents/client-agent";
import { createAgentMessageHandlers } from "../../../../../lib/agents/message-route";

export const dynamic = "force-dynamic";

const handlers = createAgentMessageHandlers({
  agentType: "client",
  errorLabel: "客户伙伴小雪",
  fallbackInstructions: clientAgentInstructions,
  run: runClientAgent,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
