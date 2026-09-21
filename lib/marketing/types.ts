export const marketingPlatforms = ["xiaohongshu", "wechat"] as const;
export type MarketingPlatform = typeof marketingPlatforms[number];

export const marketingStatuses = ["draft", "in_review", "completed", "archived"] as const;
export type MarketingStatus = typeof marketingStatuses[number];

export const marketingPlatformLabels: Record<MarketingPlatform, string> = {
  xiaohongshu: "小红书",
  wechat: "微信公众号",
};

export const marketingStatusLabels: Record<MarketingStatus, string> = {
  draft: "草稿",
  in_review: "待确认",
  completed: "已完成",
  archived: "已归档",
};

export function isMarketingPlatform(value: unknown): value is MarketingPlatform {
  return typeof value === "string" && marketingPlatforms.includes(value as MarketingPlatform);
}

export function isMarketingStatus(value: unknown): value is MarketingStatus {
  return typeof value === "string" && marketingStatuses.includes(value as MarketingStatus);
}
