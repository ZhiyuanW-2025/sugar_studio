import { modelAgentTypes, modelProviders, type ModelAgentType, type ModelProvider } from "./catalog";

export function isModelProvider(value: unknown): value is ModelProvider {
  return typeof value === "string" && modelProviders.includes(value as ModelProvider);
}

export function isModelAgentType(value: unknown): value is ModelAgentType {
  return typeof value === "string" && modelAgentTypes.includes(value as ModelAgentType);
}

export function cleanModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  return model.length > 0 && model.length <= 120 ? model : null;
}

export function cleanApiKey(value: unknown, required: boolean): string | null | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") return null;
  const apiKey = value.trim();
  return apiKey.length >= 8 && apiKey.length <= 512 ? apiKey : null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
