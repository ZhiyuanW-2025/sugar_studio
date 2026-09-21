export const imageModelOptions = [
  {
    value: "gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    description: "速度优先，适合日常视觉草图和快速迭代。",
  },
  {
    value: "gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    description: "质量优先，适合最终视觉与精细构图。",
  },
  {
    value: "gpt-image-2",
    label: "GPT Image 2",
    description: "通用图片生成模型。",
  },
] as const;

export type ImageModel = (typeof imageModelOptions)[number]["value"];

export const DEFAULT_IMAGE_MODEL: ImageModel = "gpt-image-2.5-flare";

export const imageSizeOptions = [
  { value: "1024x1024", label: "方形 · 1024 × 1024" },
  { value: "1536x1024", label: "横向 · 1536 × 1024" },
  { value: "1024x1536", label: "竖向 · 1024 × 1536" },
] as const;

export type ImageSize = (typeof imageSizeOptions)[number]["value"];

export const imageQualityOptions = [
  { value: "low", label: "草图" },
  { value: "medium", label: "标准" },
  { value: "high", label: "精细" },
] as const;

export type ImageQuality = (typeof imageQualityOptions)[number]["value"];

export function isImageModel(value: unknown): value is ImageModel {
  return typeof value === "string" && imageModelOptions.some((option) => option.value === value);
}

export function isImageSize(value: unknown): value is ImageSize {
  return typeof value === "string" && imageSizeOptions.some((option) => option.value === value);
}

export function isImageQuality(value: unknown): value is ImageQuality {
  return typeof value === "string" && imageQualityOptions.some((option) => option.value === value);
}
