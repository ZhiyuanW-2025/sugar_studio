import "server-only";

import OpenAI, { toFile } from "openai";
import type { VisualBrief } from "../../handoffs/briefs";
import type { ImageQuality, ImageSize } from "../../image-generation/catalog";
import {
  resolveImageModelConfig,
  type ResolvedImageModelConfig,
} from "../../image-generation/service";

export type ImageTaskRequest = {
  userId: string;
  projectId: string;
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
  brief?: VisualBrief;
  modelConfig?: ResolvedImageModelConfig;
};

export type GeneratedImageResult = {
  status: "completed";
  provider: "openai";
  model: string;
  bytes: Uint8Array;
  mimeType: "image/png";
};

export type ImageEditTaskRequest = ImageTaskRequest & {
  sources: Array<{
    bytes: Uint8Array;
    fileName: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  }>;
};

/**
 * Server-only image generation boundary. The caller must authenticate the user,
 * authorize project membership, and obtain explicit confirmation before calling.
 */
export async function generateImage(request: ImageTaskRequest): Promise<GeneratedImageResult> {
  const config = request.modelConfig ?? await resolveImageModelConfig(request.userId);
  if (config.provider !== "openai") throw new Error("Unsupported image provider.");

  const client = new OpenAI({ apiKey: config.apiKey });
  const response = await client.images.generate({
    model: config.model,
    prompt: request.prompt,
    n: 1,
    size: request.size,
    quality: request.quality,
    output_format: "png",
  });
  const base64 = response.data?.[0]?.b64_json;
  if (!base64) throw new Error("Image provider returned no image data.");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return {
    status: "completed",
    provider: config.provider,
    model: config.model,
    bytes,
    mimeType: "image/png",
  };
}

export async function editImage(request: ImageEditTaskRequest): Promise<GeneratedImageResult> {
  const config = request.modelConfig ?? await resolveImageModelConfig(request.userId);
  if (config.provider !== "openai") throw new Error("Unsupported image provider.");

  const client = new OpenAI({ apiKey: config.apiKey });
  const images = await Promise.all(request.sources.map((source) => toFile(source.bytes, source.fileName, {
    type: source.mimeType,
  })));
  const response = await client.images.edit({
    model: config.model,
    image: images,
    prompt: request.prompt,
    n: 1,
    size: request.size,
    quality: request.quality,
    output_format: "png",
  });
  const base64 = response.data?.[0]?.b64_json;
  if (!base64) throw new Error("Image provider returned no edited image data.");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return {
    status: "completed",
    provider: config.provider,
    model: config.model,
    bytes,
    mimeType: "image/png",
  };
}
