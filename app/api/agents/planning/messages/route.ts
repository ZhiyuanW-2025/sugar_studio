import { planningAgentInstructions, runPlanningAgent } from "../../../../../lib/agents/planning-agent";
import { createAgentMessageHandlers } from "../../../../../lib/agents/message-route";

export const dynamic = "force-dynamic";

const handlers = createAgentMessageHandlers({
  agentType: "planning",
  errorLabel: "策划 Agent",
  fallbackInstructions: planningAgentInstructions,
  run: runPlanningAgent,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
