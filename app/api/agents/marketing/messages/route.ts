import { marketingAgentInstructions, runMarketingAgent } from "../../../../../lib/agents/marketing-agent";
import { createAgentMessageHandlers } from "../../../../../lib/agents/message-route";

export const dynamic = "force-dynamic";

const handlers = createAgentMessageHandlers({
  agentType: "marketing",
  errorLabel: "宣传委员豆豆",
  fallbackInstructions: marketingAgentInstructions,
  run: runMarketingAgent,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
