import { createHmac } from "node:crypto";

const NEWTON_GATEWAY = "https://gw.open.1688.com/openapi";
const PROCUREMENT_WORKFLOW = "1688-supplychain-procurement-search";
const PROCUREMENT_INQUIRY_WORKFLOW = "1688-supplychain-procurement-inquiry";
const POLL_INTERVAL_MS = 3_000;
const QUEUED_POLL_INTERVAL_MS = 6_000;
const REQUEST_TIMEOUT_MS = 30_000;
const EXECUTION_TIMEOUT_MS = 12 * 60_000;
const QUEUE_TIMEOUT_MS = 30 * 60_000;
const MAX_SAFE_ROWS = 50;

export type NewtonTaskStatus =
  | "INIT"
  | "RUNNING"
  | "QUEUED"
  | "WAIT_SKILL"
  | "WAIT_USER"
  | "END"
  | "KILL"
  | "ERROR"
  | (string & {});

export type NewtonChunk = {
  index?: number;
  type?: string;
  content?: unknown;
  [key: string]: unknown;
};

export type ProcurementProduct = {
  item_id: string | null;
  sku_id: string | null;
  title: string;
  image_url: string | null;
  unit_price: number | null;
  total_price: number | null;
  min_order_qty: number | null;
  sales_count: number | null;
  supplier_name: string | null;
  seller_login_id: string | null;
  supplier_years: number | null;
  supplier_city: string | null;
  factory_tag: string | null;
  source_factory_info: string | null;
  delivery_timeliness: string | null;
  customization: string | null;
  service_performance: string | null;
  customer_star: string | null;
  recommendation_reasons: string[];
  requirement_match: string | null;
  product_url: string | null;
};

export type NewtonSearchResult = {
  taskId: string;
  sessionId: string | null;
  products: ProcurementProduct[];
};

export type NewtonInquiryInput = {
  products: Array<{ itemId: string; productUrl: string; title?: string | null }>;
  requirement: string;
  questions: string[];
  mode: "single_round" | "multi_round";
  timeoutMinutes: number;
};

export type NewtonInquiryMessage = {
  externalId: string | null;
  sender: "buyer" | "seller" | "system";
  content: string;
  sentAt: string | null;
};

export type NewtonInquiryTargetResult = {
  itemId: string | null;
  productUrl: string | null;
  supplierName: string | null;
  sellerLoginId: string | null;
  shopUrl: string | null;
  status: string;
  summary: string | null;
  messages: NewtonInquiryMessage[];
};

export type NewtonInquiryResult = {
  taskId: string | null;
  wwTaskId: string | null;
  status: string;
  completed: boolean;
  targets: NewtonInquiryTargetResult[];
};

type NewtonClientOptions = {
  appKey?: string;
  appSecret?: string;
  accessToken?: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  queuedPollIntervalMs?: number;
  requestTimeoutMs?: number;
  executionTimeoutMs?: number;
  queueTimeoutMs?: number;
};

type NewtonResponse = Record<string, unknown>;

export class NewtonApiError extends Error {
  code: string | null;
  status: number | null;
  traceId: string | null;
  retryable: boolean;

  constructor(message: string, options: { code?: string | null; status?: number | null; traceId?: string | null; retryable?: boolean } = {}) {
    super(message);
    this.name = "NewtonApiError";
    this.code = options.code ?? null;
    this.status = options.status ?? null;
    this.traceId = options.traceId ?? null;
    this.retryable = options.retryable ?? false;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function compactStringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function firstValue(source: unknown, paths: string[]): unknown {
  for (const path of paths) {
    let current: unknown = source;
    for (const part of path.split(".")) current = asObject(current)?.[part];
    if (current !== undefined && current !== null && current !== "") return current;
  }
  return null;
}

function textValue(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[,，￥¥元件个起]/g, "").trim();
  const matched = normalized.match(/-?\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(textValue).filter((item): item is string => Boolean(item));
  const text = textValue(value);
  return text ? [text] : [];
}

function namedValues(value: unknown): Array<{ key: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const object = asObject(item);
    const key = textValue(object?.key ?? object?.keyword);
    const text = textValue(object?.value);
    return key && text ? [{ key, value: text }] : [];
  });
}

function recommendationReasons(value: unknown): string[] {
  const object = asObject(value);
  if (object) return Object.values(object).map(textValue).filter((item): item is string => Boolean(item));
  return stringList(value);
}

function requirementMatch(value: unknown): string | null {
  if (!Array.isArray(value)) return textValue(value);
  const parts = value.flatMap((item) => {
    const object = asObject(item);
    const keyword = textValue(object?.keyword);
    if (!keyword) return [];
    return [`${numberValue(object?.satisfy) === 1 ? "满足" : "未满足"}：${keyword}`];
  });
  return parts.length ? parts.join("；") : null;
}

function normalizeProduct(row: unknown): ProcurementProduct | null {
  const source = asObject(row);
  if (!source) return null;
  const itemId = textValue(firstValue(source, ["item_id", "itemId", "offerId", "offer_id", "productId", "product_id", "id"]));
  const skuId = textValue(firstValue(source, ["sku_id", "skuId", "specId", "spec_id", "sku.id"]));
  const title = textValue(firstValue(source, ["title", "subject", "name", "productName", "product_name", "item.title", "offerTitle"]));
  if (!title && !itemId) return null;
  const explicitUrl = textValue(firstValue(source, ["product_url", "productUrl", "detailUrl", "detail_url", "offerUrl", "url", "item.url"]));
  const performance = namedValues(source.servicePerformance);
  const customization = performance.find((item) => item.key.includes("定制"))?.value ?? null;

  return {
    item_id: itemId,
    sku_id: skuId,
    title: title ?? `1688 商品 ${itemId}`,
    image_url: textValue(firstValue(source, ["image_url", "imageUrl", "mainImageUrl", "main_image_url", "picUrl", "picture", "image", "item.imageUrl"])),
    unit_price: numberValue(firstValue(source, ["unit_price", "unitPrice", "realtimeSinglePrice", "price.originPriceYuan", "priceInfo.price", "price_info.price", "sku.price", "price"])),
    total_price: numberValue(firstValue(source, ["total_price", "totalPrice", "realtimeTotalPrice", "amount", "priceInfo.totalPrice", "price_info.total_price"])),
    min_order_qty: numberValue(firstValue(source, ["min_order_qty", "minOrderQty", "newtonData.min_order_qty", "minOrderQuantity", "minimumOrderQuantity", "moq", "beginAmount", "startQuantity"])),
    sales_count: numberValue(firstValue(source, ["sales_count", "salesCount", "saleQuantity", "soldCount", "transactionCount", "tradeQuantity"])),
    supplier_name: textValue(firstValue(source, ["supplier_name", "supplierName", "company", "companyName", "sellerName", "supplier.name", "seller.companyName"])),
    seller_login_id: textValue(firstValue(source, ["seller_login_id", "sellerLoginId", "loginId", "supplier.loginId", "seller.loginId"])),
    supplier_years: numberValue(firstValue(source, ["supplier_years", "supplierYears", "digital2Map.tpServiceYear", "years", "shopYears", "supplier.shopYears", "seller.shopYears"])),
    supplier_city: textValue(firstValue(source, ["supplier_city", "supplierCity", "digital2Map.addressCity", "city", "location", "supplier.city", "seller.city"])),
    factory_tag: textValue(firstValue(source, ["factory_tag", "factoryTag", "sourceFactoryTag", "factory.label"])),
    source_factory_info: textValue(firstValue(source, ["source_factory_info", "sourceFactoryInfo", "factoryInfo", "factory.info"])),
    delivery_timeliness: textValue(firstValue(source, ["delivery_timeliness", "deliveryTimeliness", "deliveryScore", "deliveryPerformance", "fulfillment"])),
    customization: textValue(firstValue(source, ["customization", "customizationInfo", "customService", "customizable", "logoCustomization"])) ?? customization,
    service_performance: textValue(firstValue(source, ["service_performance", "serviceScore", "service"])) ?? (performance.length ? performance.map((item) => `${item.key}：${item.value}`).join("；") : null),
    customer_star: textValue(firstValue(source, ["customer_star", "customerStar", "star", "rating", "supplier.rating"])),
    recommendation_reasons: recommendationReasons(firstValue(source, ["recommendation_reasons", "recommendationReasons", "recommendReasonMap", "recommendReasons", "reasons"])),
    requirement_match: requirementMatch(firstValue(source, ["requirement_match", "requirementMatch", "recallMatchSummary", "match", "matchAnalysis"])),
    product_url: explicitUrl ?? (itemId ? `https://detail.1688.com/offer/${encodeURIComponent(itemId)}.html` : null),
  };
}

function extractRows(value: unknown): unknown[] {
  const parsed = parseJson(value);
  if (Array.isArray(parsed)) return parsed;
  const object = asObject(parsed);
  if (!object) return [];
  for (const key of ["result", "rows", "list", "items", "records", "dataSource"]) {
    const candidate = parseJson(object[key]);
    if (Array.isArray(candidate)) return candidate;
  }
  const nestedData = asObject(parseJson(object.data));
  if (nestedData) return extractRows(nestedData);
  return [];
}

function parseChunks(value: unknown): NewtonChunk[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item) => asObject(item)).map((item) => item as NewtonChunk) : [];
}

function collectObjects(value: unknown, keys: string[]): Record<string, unknown>[] {
  const object = asObject(parseJson(value));
  if (!object) return [];
  for (const key of keys) {
    const candidate = parseJson(object[key]);
    if (Array.isArray(candidate)) return candidate.map(asObject).filter((item): item is Record<string, unknown> => Boolean(item));
  }
  return [];
}

function timestampValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const raw = textValue(value);
  if (!raw) return null;
  if (/^\d{10,13}$/.test(raw)) return timestampValue(Number(raw));
  const milliseconds = Date.parse(raw);
  return Number.isNaN(milliseconds) ? null : new Date(milliseconds).toISOString();
}

function normalizeInquiryMessages(value: unknown): NewtonInquiryMessage[] {
  const result = asObject(parseJson(value)) ?? {};
  const nestedResult = asObject(parseJson(result.result)) ?? {};
  const offerModel = asObject(parseJson(result.imOfferModel)) ?? {};
  const nestedOfferModel = asObject(parseJson(nestedResult.imOfferModel)) ?? {};
  const candidates = [
    ...collectObjects(result, ["messages", "conversation", "conversations", "chatRecords", "records"]),
    ...collectObjects(result.originalConversation, ["messages", "conversation", "records"]),
    ...collectObjects(nestedResult, ["messages", "conversation", "conversations", "chatRecords", "records"]),
    ...collectObjects(offerModel, ["dialogueList", "messages", "conversation", "records"]),
    ...collectObjects(nestedOfferModel, ["dialogueList", "messages", "conversation", "records"]),
  ];
  const seen = new Set<string>();
  return candidates.flatMap((item) => {
    const content = textValue(firstValue(item, ["content", "text", "message", "answer", "question"]));
    if (!content) return [];
    const rawSender = (textValue(firstValue(item, ["sender", "role", "speaker", "from", "senderType"])) ?? "system").toLowerCase();
    const sender: NewtonInquiryMessage["sender"] = /seller|merchant|supplier|卖家|商家/.test(rawSender)
      ? "seller"
      : /buyer|user|采购|买家/.test(rawSender) ? "buyer" : "system";
    const externalId = textValue(firstValue(item, ["id", "messageId", "msgId"]));
    const sentAt = timestampValue(firstValue(item, ["sentAt", "sendTime", "createdAt", "time", "timestamp"]));
    const identity = externalId ?? `${sender}:${sentAt ?? ""}:${content}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{ externalId, sender, content, sentAt }];
  });
}

export function normalizeInquiryResult(value: unknown): NewtonInquiryResult {
  const root = asObject(parseJson(value)) ?? {};
  const data = asObject(parseJson(root.data)) ?? asObject(parseJson(asObject(root.result)?.data)) ?? asObject(parseJson(root.result)) ?? root;
  const subTasks = collectObjects(data, ["subTasks", "subtasks", "tasks"]);
  const targets = subTasks.flatMap((subTask) => {
    const topics = collectObjects(subTask, ["topics", "topicList"]);
    const sources = topics.length ? topics : [subTask];
    return sources.map((topic) => {
      const topicResult = asObject(parseJson(topic.result)) ?? topic;
      const summaryValue = firstValue(topicResult, ["summary", "answerSummary", "aiSummary", "conclusion"]);
      const summary = Array.isArray(summaryValue)
        ? summaryValue.map((item) => {
          const entry = asObject(item);
          const answer = textValue(entry?.answer ?? entry?.content ?? entry?.text ?? item);
          const question = textValue(entry?.question);
          return answer ? (question ? `${question}：${answer}` : answer) : null;
        }).filter(Boolean).join("；") || null
        : textValue(summaryValue);
      return {
        itemId: textValue(firstValue(topicResult, ["itemId", "item_id", "offerId", "product.itemId"]))
          ?? textValue(firstValue(subTask, ["itemId", "item_id", "offerId", "product.itemId"])),
        productUrl: textValue(firstValue(topicResult, ["productUrl", "product_url", "offerUrl", "url"]))
          ?? textValue(firstValue(subTask, ["productUrl", "product_url", "offerUrl", "url"])),
        supplierName: textValue(firstValue(topicResult, ["supplierName", "sellerName", "companyName", "seller.name"]))
          ?? textValue(firstValue(subTask, ["supplierName", "sellerName", "companyName", "seller.name"])),
        sellerLoginId: textValue(firstValue(topicResult, ["sellerLoginId", "seller_login_id", "loginId", "seller.loginId"]))
          ?? textValue(firstValue(subTask, ["sellerLoginId", "seller_login_id", "loginId", "seller.loginId"])),
        shopUrl: textValue(firstValue(topicResult, ["shopUrl", "sellerUrl", "supplierUrl"]))
          ?? textValue(firstValue(subTask, ["shopUrl", "sellerUrl", "supplierUrl"])),
        status: textValue(topic.status ?? subTask.status) ?? "PENDING",
        summary,
        messages: normalizeInquiryMessages(topic),
      } satisfies NewtonInquiryTargetResult;
    });
  });
  return {
    taskId: textValue(data.taskId ?? root.taskId),
    wwTaskId: textValue(data.wwTaskId ?? data.thirdPartyTaskId ?? root.wwTaskId),
    status: textValue(root.inquiryStatus ?? data.status ?? asObject(root.result)?.inquiryStatus) ?? "PENDING",
    completed: data.completed === true,
    targets,
  };
}

export function normalizeProcurementProducts(rows: unknown[]): ProcurementProduct[] {
  const seen = new Set<string>();
  const products: ProcurementProduct[] = [];
  for (const row of rows) {
    const product = normalizeProduct(row);
    if (!product) continue;
    const identity = `${product.item_id ?? product.title}:${product.sku_id ?? ""}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    products.push(product);
    if (products.length >= MAX_SAFE_ROWS) break;
  }
  return products;
}

export class NewtonClient {
  private appKey: string;
  private appSecret: string;
  private accessToken: string;
  private fetchImpl: typeof fetch;
  private sleep: (milliseconds: number) => Promise<void>;
  private now: () => number;
  private pollIntervalMs: number;
  private queuedPollIntervalMs: number;
  private requestTimeoutMs: number;
  private executionTimeoutMs: number;
  private queueTimeoutMs: number;

  constructor(options: NewtonClientOptions = {}) {
    this.appKey = options.appKey ?? process.env.NEWTON_APP_KEY?.trim() ?? "";
    this.appSecret = options.appSecret ?? process.env.NEWTON_APP_SECRET?.trim() ?? "";
    this.accessToken = options.accessToken ?? process.env.NEWTON_ACCESS_TOKEN?.trim() ?? "";
    if (!this.appKey || !this.appSecret || !this.accessToken) {
      throw new NewtonApiError("1688 找品服务尚未完成服务端配置。", { code: "NEWTON_NOT_CONFIGURED" });
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.queuedPollIntervalMs = options.queuedPollIntervalMs ?? QUEUED_POLL_INTERVAL_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.executionTimeoutMs = options.executionTimeoutMs ?? EXECUTION_TIMEOUT_MS;
    this.queueTimeoutMs = options.queueTimeoutMs ?? QUEUE_TIMEOUT_MS;
  }

  private signature(apiName: string, params: Record<string, unknown>): string {
    const apiPath = `param2/1/com.alibaba.agent/${apiName}/${this.appKey}`;
    const signText = apiPath + Object.keys(params).sort().map((key) => `${key}${compactStringify(params[key])}`).join("");
    return createHmac("sha1", this.appSecret).update(signText, "utf8").digest("hex").toUpperCase();
  }

  private async request(apiName: string, businessParams: Record<string, unknown>, retrySafe = false): Promise<NewtonResponse> {
    const attempts = retrySafe ? 3 : 1;
    let lastError: NewtonApiError | null = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const params: Record<string, unknown> = {
        ...businessParams,
        access_token: this.accessToken,
        _aop_timestamp: String(this.now()),
      };
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) body.set(key, compactStringify(value));
      body.set("_aop_signature", this.signature(apiName, params));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const response = await this.fetchImpl(`${NEWTON_GATEWAY}/param2/1/com.alibaba.agent/${apiName}/${this.appKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as NewtonResponse | null;
        const nestedResult = asObject(payload?.result);
        const code = textValue(payload?.errorCode ?? payload?.code ?? nestedResult?.errorCode ?? nestedResult?.error);
        const traceId = textValue(payload?.eagleTraceId ?? payload?.traceId ?? nestedResult?.eagleTraceId);
        const rateLimited = response.status === 429 || Boolean(code?.startsWith("RATE_LIMIT_"));
        if (!response.ok || payload?.success === false || nestedResult?.success === false || code) {
          const message = rateLimited ? "1688 找品服务当前繁忙，请稍后重试。" : "1688 找品服务请求失败。";
          throw new NewtonApiError(message, { code, status: response.status, traceId, retryable: rateLimited || response.status >= 500 });
        }
        return payload ?? {};
      } catch (error) {
        const converted = error instanceof NewtonApiError
          ? error
          : new NewtonApiError(error instanceof Error && error.name === "AbortError" ? "1688 找品服务请求超时。" : "暂时无法连接 1688 找品服务。", { code: "NEWTON_NETWORK_ERROR", retryable: true });
        lastError = converted;
        if (!retrySafe || !converted.retryable || attempt === attempts - 1) throw converted;
        await this.sleep(500 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new NewtonApiError("1688 找品服务请求失败。");
  }

  async createProcurementTask(requirement: string) {
    const safeMessage = `${requirement.trim()}\n\n安全边界：本任务只进行找品、供应商比较和采购分析；不要询盘、不要下单、不要付款。`;
    const response = await this.request("newtoncloud.task.create", {
      message: safeMessage,
      workflowName: PROCUREMENT_WORKFLOW,
      auto: true,
    });
    const taskId = textValue(response.taskId);
    if (!taskId) throw new NewtonApiError("1688 找品任务创建后未返回任务编号。", { code: "NEWTON_MISSING_TASK_ID" });
    return { taskId, sessionId: textValue(response.sessionId), status: textValue(response.status) as NewtonTaskStatus | null };
  }

  async createProductInquiryTask(input: NewtonInquiryInput) {
    if (input.products.length < 1 || input.products.length > 10) {
      throw new NewtonApiError("一次询盘需要选择 1–10 个商品。", { code: "INVALID_INQUIRY_PRODUCTS" });
    }
    if (!input.requirement.trim() || input.questions.length < 1) {
      throw new NewtonApiError("请填写采购需求和至少一个询盘问题。", { code: "INVALID_INQUIRY_CONTENT" });
    }
    const timeoutMinutes = Math.max(5, Math.min(120, Math.round(input.timeoutMinutes)));
    const productLines = input.products.map((product, index) => `${index + 1}. ${product.productUrl}${product.title ? `（${product.title}）` : ""}`);
    const questionLines = input.questions.map((question, index) => `${index + 1}）${question.trim()}`);
    const roundInstructions = input.mode === "multi_round"
      ? "请进行多轮沟通；商家未明确回答的问题继续追问，全部问题得到明确答复、商家拒绝继续沟通或达到超时时间时结束。"
      : "只发送一轮固定问题，不要自动追问。";
    const message = [
      "请使用 1688 采购技能，分别针对以下商品链接向对应商家发起询盘：",
      ...productLines,
      "",
      `采购需求：${input.requirement.trim()}`,
      "询盘问题：",
      ...questionLines,
      "",
      roundInstructions,
      `询盘超时时长：${timeoutMinutes} 分钟。`,
      "sendOriginal=true，确保商家能够看到问题文字。",
      "安全边界：本任务只允许询盘和收集回复；不得下单、不得付款、不得向商家作出最终采购承诺。",
      "forceSkillId: 1688-supplychain-procurement",
    ].join("\n");
    const response = await this.request("newtoncloud.task.create", {
      message,
      workflowName: PROCUREMENT_INQUIRY_WORKFLOW,
      auto: true,
    });
    const taskId = textValue(response.taskId ?? asObject(response.result)?.taskId);
    if (!taskId) throw new NewtonApiError("1688 询盘任务创建后未返回任务编号。", { code: "NEWTON_MISSING_TASK_ID" });
    return {
      taskId,
      sessionId: textValue(response.sessionId ?? asObject(response.result)?.sessionId),
      status: textValue(response.status ?? asObject(response.result)?.status) as NewtonTaskStatus | null,
    };
  }

  async getBatchInquiryResult(input: { taskId?: string; wwTaskId?: string }): Promise<NewtonInquiryResult> {
    if (!input.taskId && !input.wwTaskId) throw new NewtonApiError("缺少询盘任务编号。", { code: "INVALID_INQUIRY_TASK" });
    const response = await this.request("newtoncloud.batchInquiry.getResult", {
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.wwTaskId ? { wwTaskId: input.wwTaskId } : {}),
    }, true);
    return normalizeInquiryResult(response);
  }

  async killTask(taskId: string, reason = "用户取消采购询盘") {
    return this.request("newtoncloud.task.kill", { taskId, reason }, false);
  }

  async getTask(taskId: string, fromIndex: number) {
    return this.request("newtoncloud.task.get", { taskId, fromIndex, includeBlocks: true }, true);
  }

  async fetchTable(taskId: string, reference: Record<string, unknown>) {
    const params: Record<string, unknown> = {
      taskId,
      scene: reference.scene,
      subScene: reference.subScene,
      id: reference.id,
    };
    if (reference.stage != null) params.stage = reference.stage;
    return this.request("newtoncloud.task.fetch", params, true);
  }

  private async rowsFromChunks(taskId: string, chunks: NewtonChunk[]) {
    const tables = chunks.filter((chunk) => chunk.type === "complex_table").map((chunk) => asObject(parseJson(chunk.content))).filter((item): item is Record<string, unknown> => Boolean(item));
    for (const table of [...tables].reverse()) {
      if (table.__dataFilled === true) {
        const rows = extractRows(asObject(parseJson(table.data))?.result ?? table.data);
        if (rows.length > 0) return rows;
      }
    }
    for (const table of [...tables].reverse()) {
      if (!table.scene || !table.subScene || table.id == null) continue;
      const fetched = await this.fetchTable(taskId, table);
      const resultObject = asObject(parseJson(fetched.result)) ?? fetched;
      const data = asObject(resultObject)?.data ?? resultObject;
      const rows = extractRows(data);
      if (rows.length > 0) return rows;
    }
    return [];
  }

  async searchProducts(requirement: string): Promise<NewtonSearchResult> {
    if (!requirement.trim()) throw new NewtonApiError("请先提供明确的找品需求。", { code: "INVALID_REQUIREMENT" });
    const created = await this.createProcurementTask(requirement);
    const allChunks: NewtonChunk[] = [];
    const startedAt = this.now();
    let executionStartedAt: number | null = created.status === "QUEUED" ? null : startedAt;
    let fromIndex = 0;

    while (true) {
      const response = await this.getTask(created.taskId, fromIndex);
      const status = (textValue(response.status) ?? "INIT") as NewtonTaskStatus;
      const chunks = parseChunks(response.chunks);
      allChunks.push(...chunks);
      const nextIndex = numberValue(response.nextIndex);
      fromIndex = nextIndex != null ? nextIndex : fromIndex + chunks.length;

      if (status === "END") break;
      if (status === "WAIT_USER") {
        throw new NewtonApiError("1688 找品任务需要补充信息，请把需求说得更具体后重试。", { code: "NEWTON_WAIT_USER" });
      }
      if (status === "KILL") throw new NewtonApiError("1688 找品任务已被终止。", { code: "NEWTON_TASK_KILLED" });
      if (status === "ERROR") throw new NewtonApiError("1688 找品任务执行失败，请稍后重试。", { code: "NEWTON_TASK_ERROR" });

      const queued = status === "QUEUED";
      if (!queued && executionStartedAt == null) executionStartedAt = this.now();
      if (queued && this.now() - startedAt > this.queueTimeoutMs) {
        throw new NewtonApiError("1688 找品任务排队超时，请稍后重试。", { code: "NEWTON_QUEUE_TIMEOUT", retryable: true });
      }
      if (executionStartedAt != null && this.now() - executionStartedAt > this.executionTimeoutMs) {
        throw new NewtonApiError("1688 找品任务执行超时，请稍后重试。", { code: "NEWTON_EXECUTION_TIMEOUT", retryable: true });
      }
      await this.sleep(queued ? this.queuedPollIntervalMs : this.pollIntervalMs);
    }

    const rows = await this.rowsFromChunks(created.taskId, allChunks);
    return {
      taskId: created.taskId,
      sessionId: created.sessionId,
      products: normalizeProcurementProducts(rows),
    };
  }
}
