import "server-only";

import { buildFeishuWikiUrl, FeishuConfigError, getFeishuConfig } from "./config";

const FEISHU_API_ORIGIN = "https://open.feishu.cn";

type JsonRecord = Record<string, unknown>;
type FeishuEnvelope<T> = { code?: number; msg?: string; data?: T };

type CachedToken = { value: string; expiresAt: number };
let tokenCache: CachedToken | null = null;

export class FeishuApiError extends Error {
  constructor(
    public readonly safeMessage: string,
    public readonly code?: number,
    public readonly status?: number,
    public readonly requestId?: string | null,
  ) {
    super(safeMessage);
    this.name = "FeishuApiError";
  }
}

export class FeishuConflictError extends Error {
  constructor(message = "飞书文档在确认期间已经更新，请重新检查后再提交。") {
    super(message);
    this.name = "FeishuConflictError";
  }
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? value as JsonRecord : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

async function getTenantAccessToken(forceRefresh = false) {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const config = getFeishuConfig();
  const response = await fetch(`${FEISHU_API_ORIGIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as JsonRecord | null;
  const token = stringValue(payload?.tenant_access_token);
  if (!response.ok || !token || (numberValue(payload?.code) ?? 0) !== 0) {
    throw new FeishuApiError("飞书应用凭证校验失败，请检查 App ID、App Secret 和应用状态。", numberValue(payload?.code) ?? undefined, response.status, response.headers.get("x-tt-logid"));
  }
  const expireSeconds = numberValue(payload?.expire) ?? 7_200;
  tokenCache = { value: token, expiresAt: Date.now() + Math.max(expireSeconds - 60, 60) * 1_000 };
  return token;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await getTenantAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  const response = await fetch(`${FEISHU_API_ORIGIN}/open-apis/${path.replace(/^\//, "")}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as FeishuEnvelope<T> | null;
  const code = numberValue(payload?.code) ?? undefined;
  if (retry && (response.status === 401 || code === 99991663 || code === 99991661)) {
    tokenCache = null;
    await getTenantAccessToken(true);
    return request<T>(path, init, false);
  }
  if (!response.ok || code !== 0 || !payload?.data) {
    const permissionProblem = response.status === 403 || code === 99991672 || code === 131006;
    throw new FeishuApiError(
      permissionProblem
        ? "飞书应用没有访问该知识空间或文档的权限，请检查应用权限和知识库成员设置。"
        : "飞书接口暂时无法完成操作，请稍后重试。",
      code,
      response.status,
      response.headers.get("x-tt-logid"),
    );
  }
  return payload.data;
}

async function requestBinary(path: string, maxBytes: number, retry = true) {
  const token = await getTenantAccessToken();
  const response = await fetch(`${FEISHU_API_ORIGIN}/open-apis/${path.replace(/^\//, "")}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (retry && response.status === 401) {
    tokenCache = null;
    return requestBinary(path, maxBytes, false);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as FeishuEnvelope<unknown> | null;
    const code = numberValue(payload?.code) ?? undefined;
    throw new FeishuApiError(
      response.status === 403 ? "飞书应用没有下载该云盘文件的权限。" : "飞书云盘文件下载失败，请稍后重试。",
      code,
      response.status,
      response.headers.get("x-tt-logid"),
    );
  }
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (declaredSize > maxBytes) throw new FeishuApiError("该媒体文件过大，当前版本只建立文件名和目录索引。", 413, 413);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new FeishuApiError("该媒体文件过大，当前版本只建立文件名和目录索引。", 413, 413);
  return { bytes, contentType: response.headers.get("content-type") };
}

export type FeishuDriveFile = {
  token: string;
  name: string;
  type: string;
  parentToken: string | null;
  url: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
};

function driveTimestamp(value: unknown) {
  const seconds = numberValue(value);
  return seconds ? new Date(seconds * 1_000).toISOString() : null;
}

export async function getFeishuDriveFolder(folderToken: string) {
  const data = await request<{ metas?: Array<{ doc_token?: string; title?: string; url?: string; doc_type?: string }> }>("drive/v1/metas/batch_query", {
    method: "POST",
    body: JSON.stringify({ request_docs: [{ doc_token: folderToken, doc_type: "folder" }], with_url: true }),
  });
  const meta = data.metas?.find((item) => item.doc_token === folderToken) ?? data.metas?.[0];
  if (!meta?.title) throw new FeishuApiError("没有找到该飞书云盘文件夹，请检查地址和可管理权限。", 131006, 403);
  return { token: folderToken, name: meta.title.trim(), url: meta.url ?? null };
}

export async function listFeishuDriveChildren(folderToken: string) {
  const files: FeishuDriveFile[] = [];
  let pageToken: string | null = null;
  do {
    const query = new URLSearchParams({ folder_token: folderToken, page_size: "200" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await request<{ files?: unknown[]; has_more?: boolean; next_page_token?: string }>(`drive/v1/files?${query}`);
    for (const value of data.files ?? []) {
      const item = record(value);
      const token = stringValue(item.token);
      const name = stringValue(item.name)?.trim();
      const type = stringValue(item.type);
      if (!token || !name || !type) continue;
      files.push({
        token,
        name,
        type,
        parentToken: stringValue(item.parent_token),
        url: stringValue(item.url),
        createdAt: driveTimestamp(item.created_time),
        modifiedAt: driveTimestamp(item.modified_time),
      });
    }
    pageToken = data.has_more && data.next_page_token ? data.next_page_token : null;
  } while (pageToken);
  return files;
}

export async function downloadFeishuDriveFile(fileToken: string, maxBytes = 30 * 1024 * 1024) {
  return requestBinary(`drive/v1/files/${encodeURIComponent(fileToken)}/download`, maxBytes);
}

export async function createFeishuDriveFolder(input: { parentFolderToken: string; name: string }) {
  const data = await request<{ token?: string; url?: string }>("drive/v1/files/create_folder", {
    method: "POST",
    body: JSON.stringify({ name: input.name, folder_token: input.parentFolderToken }),
  });
  if (!data.token) throw new FeishuApiError("飞书没有返回新建文件夹标识。");
  return { token: data.token, url: data.url ?? null };
}

export async function uploadFileToFeishuDriveFolder(input: {
  folderToken: string;
  fileName: string;
  bytes: Uint8Array;
  mimeType: string;
}) {
  const form = new FormData();
  form.set("file_name", input.fileName);
  form.set("parent_type", "explorer");
  form.set("parent_node", input.folderToken);
  form.set("size", String(input.bytes.byteLength));
  form.set("file", new Blob([new Uint8Array(input.bytes).buffer], { type: input.mimeType }), input.fileName);
  const uploaded = await request<{ file_token?: string }>("drive/v1/files/upload_all", { method: "POST", body: form });
  if (!uploaded.file_token) throw new FeishuApiError("飞书没有返回上传文件标识。");
  return { fileToken: uploaded.file_token };
}

export type FeishuWikiNode = {
  spaceId: string;
  nodeToken: string;
  parentNodeToken: string | null;
  objToken: string;
  objType: "docx" | "doc" | "sheet" | "bitable" | "file" | "mindnote";
  title: string;
  hasChild: boolean;
  editedAt: string | null;
  url: string | null;
};

function mapNode(input: unknown): FeishuWikiNode | null {
  const node = record(input);
  const nodeToken = stringValue(node.node_token);
  const objToken = stringValue(node.obj_token);
  const objType = stringValue(node.obj_type);
  const spaceId = stringValue(node.space_id);
  const title = stringValue(node.title)?.trim();
  if (!nodeToken || !objToken || !spaceId || !title || !["docx", "doc", "sheet", "bitable", "file", "mindnote"].includes(objType ?? "")) return null;
  const editedSeconds = numberValue(node.obj_edit_time);
  return {
    spaceId,
    nodeToken,
    parentNodeToken: stringValue(node.parent_node_token),
    objToken,
    objType: objType as FeishuWikiNode["objType"],
    title,
    hasChild: node.has_child === true,
    editedAt: editedSeconds ? new Date(editedSeconds * 1_000).toISOString() : null,
    url: stringValue(node.url) ?? buildFeishuWikiUrl(nodeToken),
  };
}

export type FeishuScopeTarget = {
  spaceId: string;
  rootNodeToken: string | null;
};

function configuredScope(): FeishuScopeTarget {
  const config = getFeishuConfig();
  if (!config.spaceId) throw new FeishuConfigError("请先在设置中添加飞书知识库地址。");
  return { spaceId: config.spaceId, rootNodeToken: config.rootNodeToken };
}

export async function getFeishuSpace(spaceId = configuredScope().spaceId) {
  const data = await request<{ space?: { space_id?: string; name?: string; description?: string } }>(`wiki/v2/spaces/${encodeURIComponent(spaceId)}`);
  return {
    id: data.space?.space_id ?? spaceId,
    name: data.space?.name?.trim() || "飞书企业知识库",
    description: data.space?.description?.trim() || "",
  };
}

async function listChildNodes(scope: FeishuScopeTarget, parentNodeToken: string | null) {
  const nodes: FeishuWikiNode[] = [];
  let pageToken: string | null = null;
  do {
    const query = new URLSearchParams({ page_size: "50" });
    if (parentNodeToken) query.set("parent_node_token", parentNodeToken);
    if (pageToken) query.set("page_token", pageToken);
    const data = await request<{ items?: unknown[]; has_more?: boolean; page_token?: string }>(`wiki/v2/spaces/${encodeURIComponent(scope.spaceId)}/nodes?${query}`);
    for (const item of data.items ?? []) {
      const node = mapNode(item);
      if (node) nodes.push(node);
    }
    pageToken = data.has_more && data.page_token ? data.page_token : null;
  } while (pageToken);
  return nodes;
}

export async function listFeishuWikiNodes(scope = configuredScope()) {
  const all: FeishuWikiNode[] = [];
  const queue: Array<string | null> = [];
  if (scope.rootNodeToken) {
    const root = await getFeishuWikiNode(scope.rootNodeToken, scope.spaceId);
    // Feishu commonly exposes the knowledge-space home page as a normal
    // top-level node. A user copying that page URL expects to connect the
    // whole space, including its top-level sibling files, not only the home
    // page's (usually empty) child tree.
    if (!root.parentNodeToken) {
      queue.push(null);
    } else {
      all.push(root);
      if (root.hasChild) queue.push(root.nodeToken);
    }
  } else {
    queue.push(null);
  }
  const visited = new Set<string>();
  while (queue.length > 0) {
    const parent = queue.shift() ?? null;
    if (parent && visited.has(parent)) continue;
    if (parent) visited.add(parent);
    const children = await listChildNodes(scope, parent);
    all.push(...children);
    for (const child of children) if (child.hasChild) queue.push(child.nodeToken);
    if (all.length > 5_000) throw new FeishuApiError("飞书知识库节点过多，请配置一个更小的同步根节点。")
  }
  return all;
}

export async function getFeishuWikiNode(nodeToken: string, expectedSpaceId = configuredScope().spaceId) {
  const query = new URLSearchParams({ token: nodeToken });
  const data = await request<{ node?: unknown }>(`wiki/v2/spaces/get_node?${query}`);
  const node = mapNode(data.node);
  if (!node || (expectedSpaceId && node.spaceId !== expectedSpaceId)) throw new FeishuApiError("没有在已连接的飞书知识空间中找到该文档。", 131006, 403);
  return node;
}

export type FeishuTextBlock = {
  blockId: string;
  parentId: string | null;
  blockType: number;
  text: string;
};

export type FeishuDocumentSnapshot = {
  title: string;
  content: string;
  revision: string;
  blocks: FeishuTextBlock[];
};

export async function getFeishuDocumentSnapshot(node: Pick<FeishuWikiNode, "objToken" | "objType" | "title">): Promise<FeishuDocumentSnapshot> {
  if (node.objType !== "docx") throw new FeishuApiError("第一版暂时只支持同步和编辑飞书新版文档。")
  const [raw, meta, blocks] = await Promise.all([
    request<{ content?: string }>(`docx/v1/documents/${encodeURIComponent(node.objToken)}/raw_content`),
    request<{ document?: { title?: string; revision_id?: number | string } }>(`docx/v1/documents/${encodeURIComponent(node.objToken)}`),
    getFeishuDocumentBlocks(node.objToken),
  ]);
  return {
    title: meta.document?.title?.trim() || node.title,
    content: raw.content ?? "",
    revision: String(meta.document?.revision_id ?? "-1"),
    blocks,
  };
}

function readableCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(readableCell).filter(Boolean).join(" / ");
  const object = record(value);
  return stringValue(object.text) ?? stringValue(object.name) ?? stringValue(object.link) ?? JSON.stringify(value);
}

export async function getFeishuSheetSnapshot(node: Pick<FeishuWikiNode, "objToken" | "title" | "editedAt">): Promise<FeishuDocumentSnapshot> {
  const data = await request<{ sheets?: Array<{ sheet_id?: string; title?: string; grid_properties?: { row_count?: number } }> }>(`sheets/v3/spreadsheets/${encodeURIComponent(node.objToken)}/sheets/query`);
  const blocks: FeishuTextBlock[] = [];
  for (const sheet of data.sheets ?? []) {
    if (!sheet.sheet_id) continue;
    const sheetId = sheet.sheet_id;
    const rowCount = Math.min(Math.max(sheet.grid_properties?.row_count ?? 1_000, 1), 2_000);
    const range = `${sheetId}!A1:CV${rowCount}`;
    const values = await request<{ valueRange?: { values?: unknown[][] } }>(`sheets/v2/spreadsheets/${encodeURIComponent(node.objToken)}/values/${encodeURIComponent(range)}`);
    (values.valueRange?.values ?? []).forEach((row, index) => {
      const text = row.map(readableCell).join("\t").trim();
      if (text) blocks.push({ blockId: `sheet:${sheetId}:row:${index + 1}`, parentId: sheetId, blockType: 1001, text: `${sheet.title || "工作表"} 第 ${index + 1} 行：${text}` });
    });
  }
  return {
    title: node.title,
    content: blocks.map((block) => block.text).join("\n"),
    revision: node.editedAt ?? "live",
    blocks,
  };
}

export async function getFeishuBitableSnapshot(node: Pick<FeishuWikiNode, "objToken" | "title" | "editedAt">): Promise<FeishuDocumentSnapshot> {
  const blocks: FeishuTextBlock[] = [];
  let tablePageToken: string | null = null;
  do {
    const tableQuery = new URLSearchParams({ page_size: "100" });
    if (tablePageToken) tableQuery.set("page_token", tablePageToken);
    const tables = await request<{ items?: Array<{ table_id?: string; name?: string }>; has_more?: boolean; page_token?: string }>(`bitable/v1/apps/${encodeURIComponent(node.objToken)}/tables?${tableQuery}`);
    for (const table of tables.items ?? []) {
      if (!table.table_id) continue;
      let recordPageToken: string | null = null;
      do {
        const recordQuery = new URLSearchParams({ page_size: "500" });
        if (recordPageToken) recordQuery.set("page_token", recordPageToken);
        const records = await request<{ items?: Array<{ record_id?: string; fields?: Record<string, unknown> }>; has_more?: boolean; page_token?: string }>(`bitable/v1/apps/${encodeURIComponent(node.objToken)}/tables/${encodeURIComponent(table.table_id)}/records?${recordQuery}`);
        for (const item of records.items ?? []) {
          if (!item.record_id) continue;
          const text = Object.entries(item.fields ?? {}).map(([field, value]) => `${field}: ${readableCell(value)}`).join("；");
          if (text) blocks.push({ blockId: `bitable:${table.table_id}:${item.record_id}`, parentId: table.table_id, blockType: 1002, text: `${table.name || "数据表"}：${text}` });
        }
        recordPageToken = records.has_more && records.page_token ? records.page_token : null;
      } while (recordPageToken);
    }
    tablePageToken = tables.has_more && tables.page_token ? tables.page_token : null;
  } while (tablePageToken);
  return {
    title: node.title,
    content: blocks.map((block) => block.text).join("\n"),
    revision: node.editedAt ?? "live",
    blocks,
  };
}

export async function getFeishuKnowledgeSnapshot(node: FeishuWikiNode) {
  if (node.objType === "docx") return getFeishuDocumentSnapshot(node);
  if (node.objType === "sheet") return getFeishuSheetSnapshot(node);
  if (node.objType === "bitable") return getFeishuBitableSnapshot(node);
  throw new FeishuApiError("当前飞书文件类型暂不支持自动建立知识索引。");
}

export async function createFeishuWikiDocument(title: string, scope = configuredScope()) {
  const body: JsonRecord = { obj_type: "docx", node_type: "origin", title };
  if (scope.rootNodeToken) body.parent_node_token = scope.rootNodeToken;
  const data = await request<{ node?: unknown }>(`wiki/v2/spaces/${encodeURIComponent(scope.spaceId)}/nodes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const node = mapNode(data.node);
  if (!node) throw new FeishuApiError("飞书返回了无效的知识库节点。")
  return node;
}

function textBlocks(content: string) {
  const paragraphs = content.replace(/\r\n/g, "\n").split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const paragraph of paragraphs.length ? paragraphs : [content.trim()]) {
    for (let offset = 0; offset < paragraph.length; offset += 1_800) chunks.push(paragraph.slice(offset, offset + 1_800));
  }
  return chunks.map((text) => ({ block_type: 2, text: { elements: [{ text_run: { content: text } }] } }));
}

export async function appendFeishuDocumentContent(documentId: string, content: string, expectedRevision?: string | null) {
  let revision = expectedRevision && /^\d+$/.test(expectedRevision) ? expectedRevision : "-1";
  const blocks = textBlocks(content);
  if (blocks.length === 0) throw new FeishuApiError("没有可写入飞书文档的内容。")
  for (let offset = 0; offset < blocks.length; offset += 50) {
    const result = await request<{ document_revision_id?: number | string }>(`docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children?document_revision_id=${revision}`, {
      method: "POST",
      body: JSON.stringify({ children: blocks.slice(offset, offset + 50) }),
    });
    revision = String(result.document_revision_id ?? revision);
  }
}

type FeishuBlock = { block_id?: string; block_type?: number; text?: { elements?: unknown[] }; [key: string]: unknown };

function blockPlainText(block: FeishuBlock) {
  const container = Object.values(block).find((value) => {
    const candidate = record(value);
    return Array.isArray(candidate.elements);
  });
  const elements = Array.isArray(record(container).elements) ? record(container).elements as unknown[] : [];
  return elements.map((element) => stringValue(record(record(element).text_run).content) ?? "").join("");
}

export async function getFeishuDocumentBlocks(documentId: string): Promise<FeishuTextBlock[]> {
  let pageToken: string | null = null;
  const blocks: FeishuTextBlock[] = [];
  do {
    const query = new URLSearchParams({ page_size: "500", document_revision_id: "-1" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await request<{ items?: FeishuBlock[]; has_more?: boolean; page_token?: string }>(`docx/v1/documents/${encodeURIComponent(documentId)}/blocks?${query}`);
    for (const block of data.items ?? []) {
      if (!block.block_id) continue;
      blocks.push({
        blockId: block.block_id,
        parentId: stringValue(block.parent_id),
        blockType: numberValue(block.block_type) ?? 0,
        text: blockPlainText(block),
      });
    }
    pageToken = data.has_more && data.page_token ? data.page_token : null;
  } while (pageToken);
  return blocks;
}

export async function replaceFeishuBlockById(input: { documentId: string; blockId: string; newText: string; revision: string }) {
  await request(`docx/v1/documents/${encodeURIComponent(input.documentId)}/blocks/${encodeURIComponent(input.blockId)}?document_revision_id=${encodeURIComponent(input.revision)}`, {
    method: "PATCH",
    body: JSON.stringify({ update_text_elements: { elements: [{ text_run: { content: input.newText } }] } }),
  });
}

export async function subscribeFeishuDocumentEvents(documentId: string, fileType: "docx" | "sheet" | "bitable") {
  await request<Record<string, never>>(`drive/v1/files/${encodeURIComponent(documentId)}/subscribe?file_type=${fileType}`, {
    method: "POST",
  });
}

export async function replaceExactFeishuBlock(input: { documentId: string; oldText: string; newText: string; expectedRevision: string | null }) {
  let pageToken: string | null = null;
  const matches: Array<{ blockId: string; text: string }> = [];
  let liveRevision = "-1";
  do {
    const query = new URLSearchParams({ page_size: "500", document_revision_id: "-1" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await request<{ items?: FeishuBlock[]; has_more?: boolean; page_token?: string; document_revision_id?: number | string }>(`docx/v1/documents/${encodeURIComponent(input.documentId)}/blocks?${query}`);
    liveRevision = String(data.document_revision_id ?? liveRevision);
    for (const block of data.items ?? []) {
      const text = blockPlainText(block);
      if (block.block_id && text.trim() === input.oldText.trim()) matches.push({ blockId: block.block_id, text });
    }
    pageToken = data.has_more && data.page_token ? data.page_token : null;
  } while (pageToken);

  if (input.expectedRevision && liveRevision !== "-1" && input.expectedRevision !== liveRevision) throw new FeishuConflictError();
  if (matches.length !== 1) throw new FeishuConflictError(matches.length === 0 ? "没有找到需要替换的原文，文档可能已被修改。" : "原文在文档中出现多次，无法安全确定修改位置。")
  await request(`docx/v1/documents/${encodeURIComponent(input.documentId)}/blocks/${encodeURIComponent(matches[0].blockId)}?document_revision_id=${liveRevision}`, {
    method: "PATCH",
    body: JSON.stringify({ update_text_elements: { elements: [{ text_run: { content: input.newText } }] } }),
  });
}

export async function uploadFileToFeishuWiki(input: { fileName: string; bytes: Uint8Array; mimeType: string; scope?: FeishuScopeTarget; parentNodeToken?: string | null }) {
  const scope = input.scope ?? configuredScope();
  const root = await request<{ token?: string }>("drive/explorer/v2/root_folder/meta");
  if (!root.token) throw new FeishuApiError("无法获取飞书应用云空间根目录。")
  const form = new FormData();
  form.set("file_name", input.fileName);
  form.set("parent_type", "explorer");
  form.set("parent_node", root.token);
  form.set("size", String(input.bytes.byteLength));
  form.set("file", new Blob([new Uint8Array(input.bytes).buffer], { type: input.mimeType }), input.fileName);
  const uploaded = await request<{ file_token?: string }>("drive/v1/files/upload_all", { method: "POST", body: form });
  if (!uploaded.file_token) throw new FeishuApiError("飞书没有返回上传文件标识。")
  const body: JsonRecord = { obj_type: "file", obj_token: uploaded.file_token };
  const parentNodeToken = input.parentNodeToken ?? scope.rootNodeToken;
  if (parentNodeToken) body.parent_wiki_token = parentNodeToken;
  const moved = await request<{ wiki_token?: string; task_id?: string; applied?: boolean }>(`wiki/v2/spaces/${encodeURIComponent(scope.spaceId)}/nodes/move_docs_to_wiki`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  let nodeToken = moved.wiki_token ?? null;
  if (!nodeToken && moved.task_id) {
    // Feishu commonly completes file imports asynchronously. Resolve the
    // created Wiki node by its immutable Drive file token so callers can link
    // the authoritative source immediately instead of waiting for weekly sync.
    for (let attempt = 0; attempt < 20 && !nodeToken; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const nodes = await listFeishuWikiNodes(scope);
      nodeToken = nodes.find((node) => node.objToken === uploaded.file_token)?.nodeToken ?? null;
    }
  }
  return {
    fileToken: uploaded.file_token,
    nodeToken,
    taskId: moved.task_id ?? null,
    url: nodeToken ? buildFeishuWikiUrl(nodeToken) : null,
  };
}
