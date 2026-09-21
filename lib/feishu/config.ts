import "server-only";

export type FeishuConfig = {
  appId: string;
  appSecret: string;
  spaceId: string | null;
  rootNodeToken: string | null;
  tenantUrl: string | null;
  verificationToken: string | null;
};

export class FeishuConfigError extends Error {
  constructor(message = "飞书知识库尚未完成服务端配置。") {
    super(message);
    this.name = "FeishuConfigError";
  }
}

function read(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

function normalizeTenantUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getFeishuConfig(): FeishuConfig {
  const appId = read("FEISHU_APP_ID");
  const appSecret = read("FEISHU_APP_SECRET");
  const spaceId = read("FEISHU_SPACE_ID");
  if (!appId || !appSecret) throw new FeishuConfigError();

  return {
    appId,
    appSecret,
    spaceId,
    rootNodeToken: read("FEISHU_ROOT_NODE_TOKEN"),
    tenantUrl: normalizeTenantUrl(read("FEISHU_TENANT_URL")),
    verificationToken: read("FEISHU_VERIFICATION_TOKEN"),
  };
}

export function getFeishuConfigurationStatus() {
  const appId = read("FEISHU_APP_ID");
  const appSecret = read("FEISHU_APP_SECRET");
  const spaceId = read("FEISHU_SPACE_ID");
  return {
    configured: Boolean(appId && appSecret),
    hasAppId: Boolean(appId),
    hasAppSecret: Boolean(appSecret),
    hasSpaceId: Boolean(spaceId),
    hasRootNodeToken: Boolean(read("FEISHU_ROOT_NODE_TOKEN")),
    hasTenantUrl: Boolean(normalizeTenantUrl(read("FEISHU_TENANT_URL"))),
    hasVerificationToken: Boolean(read("FEISHU_VERIFICATION_TOKEN")),
  };
}

export function buildFeishuWikiUrl(nodeToken: string) {
  const tenantUrl = normalizeTenantUrl(read("FEISHU_TENANT_URL"));
  return tenantUrl ? `${tenantUrl}/wiki/${encodeURIComponent(nodeToken)}` : null;
}

export const FEISHU_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const FEISHU_KNOWLEDGE_FILE_MAX_BYTES = 100 * 1024 * 1024;
