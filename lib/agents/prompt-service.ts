import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelAgentType } from "../model-config/catalog";

export type ActivePrompt = {
  instructions: string;
  source: "database" | "fallback";
  version: number | null;
};

export async function resolveAgentInstructions(
  supabase: SupabaseClient,
  agentType: ModelAgentType,
  fallback: string,
): Promise<ActivePrompt> {
  try {
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id")
      .eq("agent_type", agentType)
      .maybeSingle();
    if (agentError || !agent) return { instructions: fallback, source: "fallback", version: null };

    const { data: prompt, error: promptError } = await supabase
      .from("agent_prompt_versions")
      .select("version, instructions")
      .eq("agent_id", agent.id)
      .eq("is_active", true)
      .maybeSingle();
    if (promptError || !prompt?.instructions?.trim()) {
      return { instructions: fallback, source: "fallback", version: null };
    }
    return { instructions: prompt.instructions, source: "database", version: prompt.version };
  } catch {
    return { instructions: fallback, source: "fallback", version: null };
  }
}
