import "server-only";

import { createAdminClient } from "../supabase/admin";
import {
  modelAgentTypes,
  type ModelAgentType,
  type ModelConfigSummary,
  type ModelProvider,
} from "./catalog";

type ModelConfigRow = {
  id: string;
  provider: ModelProvider;
  model: string;
  is_default: boolean;
  api_key_masked: string;
  created_at: string;
  updated_at: string;
};

type ResolvedModelRow = {
  provider: ModelProvider;
  model: string;
  api_key: string;
};

function serviceError(operation: string): Error {
  return new Error(`Model configuration ${operation} failed.`);
}

export async function listModelConfigs(userId: string): Promise<ModelConfigSummary[]> {
  const { data, error } = await createAdminClient().rpc("list_user_model_configs", {
    p_user_id: userId,
  });
  if (error) throw serviceError("list");

  return ((data ?? []) as ModelConfigRow[]).map((row) => ({
    id: row.id,
    provider: row.provider,
    model: row.model,
    isDefault: row.is_default,
    apiKeyMasked: row.api_key_masked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createModelConfig(input: {
  userId: string;
  provider: ModelProvider;
  model: string;
  apiKey: string;
  isDefault: boolean;
}): Promise<string> {
  const { data, error } = await createAdminClient().rpc("create_user_model_config", {
    p_user_id: input.userId,
    p_provider: input.provider,
    p_model: input.model,
    p_api_key: input.apiKey,
    p_is_default: input.isDefault,
  });
  if (error || typeof data !== "string") throw serviceError("create");
  return data;
}

export async function updateModelConfig(input: {
  userId: string;
  configId: string;
  provider?: ModelProvider;
  model?: string;
  apiKey?: string;
  isDefault?: boolean;
}): Promise<void> {
  const { error } = await createAdminClient().rpc("update_user_model_config", {
    p_user_id: input.userId,
    p_config_id: input.configId,
    p_provider: input.provider ?? null,
    p_model: input.model ?? null,
    p_api_key: input.apiKey ?? null,
    p_is_default: input.isDefault ?? null,
  });
  if (error) throw serviceError("update");
}

export async function deleteModelConfig(userId: string, configId: string): Promise<void> {
  const { error } = await createAdminClient().rpc("delete_user_model_config", {
    p_user_id: userId,
    p_config_id: configId,
  });
  if (error) throw serviceError("delete");
}

/**
 * Resolve the effective model for future Agent runtimes.
 *
 * This function is server-only. Its return value contains the decrypted API
 * key and must never be serialized into a browser/API response or logged.
 */
export async function resolveModelConfig(
  userId: string,
  agentType: ModelAgentType,
): Promise<{ provider: ModelProvider; model: string; apiKey: string }> {
  if (!modelAgentTypes.includes(agentType)) {
    throw new Error("Unsupported agent type.");
  }

  const { data, error } = await createAdminClient()
    .rpc("resolve_user_model_config", {
      p_user_id: userId,
      p_agent_type: agentType,
    })
    .maybeSingle();
  if (error) throw serviceError("resolve");

  const row = data as ResolvedModelRow | null;
  if (!row) {
    throw new Error("No model configuration is available for this user.");
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: row.api_key,
  };
}
