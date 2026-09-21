import "server-only";

import { createAdminClient } from "../supabase/admin";
import { DEFAULT_IMAGE_MODEL, type ImageModel } from "./catalog";

type ResolvedImageModelRow = {
  provider: "openai";
  model: string;
  credential_config_id: string;
  api_key: string;
};

export type ResolvedImageModelConfig = {
  provider: "openai";
  model: ImageModel | string;
  credentialConfigId: string;
  apiKey: string;
};

/**
 * Resolve the image model and its Vault-backed credential for server use.
 * The API key in this result must never be logged or serialized to a client.
 */
export async function resolveImageModelConfig(userId: string): Promise<ResolvedImageModelConfig> {
  const { data, error } = await createAdminClient()
    .rpc("resolve_user_image_model_config", { p_user_id: userId })
    .maybeSingle();

  if (error) throw new Error("Image model configuration resolve failed.");
  const row = data as ResolvedImageModelRow | null;
  if (!row?.api_key) {
    throw new Error("No image model configuration is available for this user.");
  }

  return {
    provider: row.provider,
    model: row.model || DEFAULT_IMAGE_MODEL,
    credentialConfigId: row.credential_config_id,
    apiKey: row.api_key,
  };
}
