import type { ImageModel, ImageQuality, ImageSize } from "./catalog";

export type ImageModelPreference = {
  provider: "openai";
  model: ImageModel;
  credentialConfigId: string;
};

export type ImageGenerationStatus = "running" | "completed" | "failed";
export type ImageReviewStatus = "draft" | "approved";
export type ImageOperation = "generate" | "edit";
export type ImageSourceKind = "generation" | "project_file" | "feishu_drive" | "design_asset";

export type DesignVisualSource = {
  kind: ImageSourceKind;
  id: string;
  name: string;
  path?: string | null;
  previewUrl?: string | null;
};

export type ImageGenerationSummary = {
  id: string;
  requestId: string;
  operation: ImageOperation;
  sourceKind: ImageSourceKind | null;
  sourceId: string | null;
  batchId?: string | null;
  batchIndex?: number;
  prompt: string;
  provider: "openai";
  model: string;
  size: ImageSize;
  quality: ImageQuality;
  status: ImageGenerationStatus;
  reviewStatus: ImageReviewStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  imageUrl: string | null;
  downloadUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};
