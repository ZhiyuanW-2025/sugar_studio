import "server-only";

import { getFeishuConfig } from "./config";

export class FeishuUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeishuUrlError";
  }
}

function trustedHost(hostname: string) {
  const lower = hostname.toLowerCase();
  if (lower === "feishu.cn" || lower.endsWith(".feishu.cn")) return true;
  if (lower === "larksuite.com" || lower.endsWith(".larksuite.com")) return true;
  const configured = getFeishuConfig().tenantUrl;
  return configured ? new URL(configured).hostname.toLowerCase() === lower : false;
}

export type ParsedFeishuWikiUrl = {
  tenantUrl: string;
  sourceUrl: string;
  spaceId: string | null;
  rootNodeToken: string | null;
};

export type ParsedFeishuDriveFolderUrl = {
  tenantUrl: string;
  sourceUrl: string;
  folderToken: string;
};

export function parseFeishuDriveFolderUrl(value: string): ParsedFeishuDriveFolderUrl {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new FeishuUrlError("请输入完整的飞书云盘文件夹 HTTPS 地址。");
  }
  if (url.protocol !== "https:" || !trustedHost(url.hostname)) {
    throw new FeishuUrlError("只允许连接可信的飞书或 Lark HTTPS 地址。");
  }
  url.hash = "";
  url.search = "";
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const driveIndex = segments.indexOf("drive");
  const tail = driveIndex >= 0 ? segments.slice(driveIndex + 1) : [];
  if (tail[0] === "shared" && !tail[1]) {
    throw new FeishuUrlError("这是共享云盘入口，无法识别具体项目。请打开项目文件夹后，复制形如 /drive/folder/… 的地址。");
  }
  const folderIndex = tail.indexOf("folder");
  const token = folderIndex >= 0 ? tail[folderIndex + 1] : null;
  if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new FeishuUrlError("无法识别云盘文件夹，请先打开具体项目文件夹，再复制浏览器地址。");
  }
  return { tenantUrl: url.origin, sourceUrl: url.toString(), folderToken: token };
}

export function parseFeishuWikiUrl(value: string): ParsedFeishuWikiUrl {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new FeishuUrlError("请输入完整的飞书知识库 HTTPS 地址。");
  }
  if (url.protocol !== "https:" || !trustedHost(url.hostname)) {
    throw new FeishuUrlError("只允许连接可信的飞书或 Lark HTTPS 地址。");
  }
  url.hash = "";
  url.search = "";
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const wikiIndex = segments.indexOf("wiki");
  if (wikiIndex < 0) throw new FeishuUrlError("该地址不是飞书知识库页面。");
  const tail = segments.slice(wikiIndex + 1);
  if (tail[0] === "settings" && tail[1] && /^[A-Za-z0-9_-]+$/.test(tail[1])) {
    return { tenantUrl: url.origin, sourceUrl: url.toString(), spaceId: tail[1], rootNodeToken: null };
  }
  if (tail[0] && /^[A-Za-z0-9_-]+$/.test(tail[0])) {
    return { tenantUrl: url.origin, sourceUrl: url.toString(), spaceId: null, rootNodeToken: tail[0] };
  }
  throw new FeishuUrlError("无法从地址中识别知识空间或目录，请复制知识库页面地址。");
}
