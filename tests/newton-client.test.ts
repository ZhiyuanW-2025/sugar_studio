import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
// @ts-expect-error -- Node 22 strip-types test entrypoint needs an explicit extension.
import { NewtonApiError, NewtonClient, normalizeInquiryResult } from "../lib/newton/client.ts";

const credentials = { appKey: "test-key", appSecret: "test-secret", accessToken: "test-token" };

test("signs requests and parses a filled complex_table without exposing credentials", async () => {
  const requests: Array<{ url: string; body: URLSearchParams }> = [];
  let call = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = new URLSearchParams(String(init?.body));
    requests.push({ url: String(input), body });
    call += 1;
    if (call === 1) return Response.json({ success: true, taskId: "task-1", sessionId: "session-1", status: "INIT" });
    return Response.json({
      success: true,
      status: "END",
      nextIndex: 1,
      chunks: JSON.stringify([{
        type: "complex_table",
        content: JSON.stringify({
          __dataFilled: true,
          data: { result: [{
            itemId: "123",
            skuId: "sku-1",
            title: "50ml透明喷雾瓶",
            realtimeSinglePrice: 0.68,
            realtimeTotalPrice: 340,
            newtonData: { min_order_qty: "500" },
            company: "测试工厂",
            digital2Map: { tpServiceYear: "6", addressCity: "浙江省台州市" },
            servicePerformance: [{ key: "履约", value: "24h支揽率90%" }, { key: "定制", value: "支持定制logo" }],
            recommendReasonMap: { factory: "源头工厂" },
            recallMatchSummary: [{ satisfy: 1, keyword: "单价1元以内" }],
          }] },
        }),
      }]),
    });
  };
  const client = new NewtonClient({ ...credentials, fetchImpl, sleep: async () => {}, now: () => 1_700_000_000_000 });
  const result = await client.searchProducts("找500个50ml透明喷雾瓶");
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].item_id, "123");
  assert.equal(result.products[0].unit_price, 0.68);
  assert.equal(result.products[0].min_order_qty, 500);
  assert.equal(result.products[0].supplier_name, "测试工厂");
  assert.equal(result.products[0].supplier_years, 6);
  assert.equal(result.products[0].customization, "支持定制logo");
  assert.equal(result.products[0].requirement_match, "满足：单价1元以内");
  assert.equal(result.products[0].product_url, "https://detail.1688.com/offer/123.html");
  assert.match(requests[0].url, /newtoncloud\.task\.create\/test-key$/);
  const signable = Object.fromEntries([...requests[0].body.entries()].filter(([key]) => key !== "_aop_signature"));
  const path = "param2/1/com.alibaba.agent/newtoncloud.task.create/test-key";
  const expected = createHmac("sha1", credentials.appSecret)
    .update(path + Object.keys(signable).sort().map((key) => `${key}${signable[key]}`).join(""), "utf8")
    .digest("hex").toUpperCase();
  assert.equal(requests[0].body.get("_aop_signature"), expected);
  assert.equal(JSON.stringify(result).includes(credentials.accessToken), false);
  assert.equal(JSON.stringify(result).includes(credentials.appSecret), false);
});

test("fetches a referenced complex_table and handles transient rate limiting", async () => {
  let getAttempts = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("task.create")) return Response.json({ success: true, taskId: "task-2", status: "QUEUED" });
    if (url.includes("task.get")) {
      getAttempts += 1;
      if (getAttempts === 1) return Response.json({ success: false, errorCode: "RATE_LIMIT_CONCURRENT" }, { status: 429 });
      return Response.json({ success: true, status: "END", nextIndex: 1, chunks: JSON.stringify([{ type: "complex_table", content: JSON.stringify({ scene: "newton", subScene: "purchase", id: "table-1", stage: "final" }) }]) });
    }
    return Response.json({ success: true, result: { success: true, data: JSON.stringify({ result: [{ itemId: "456", subject: "礼品袋", unitPrice: 1.2 }] }) } });
  };
  const client = new NewtonClient({ ...credentials, fetchImpl, sleep: async () => {}, now: () => 1_700_000_000_000 });
  const result = await client.searchProducts("找礼品袋");
  assert.equal(getAttempts, 2);
  assert.equal(result.products[0].item_id, "456");
});

test("stops safely when Newton requests user interaction", async () => {
  const fetchImpl: typeof fetch = async (input) => String(input).includes("task.create")
    ? Response.json({ success: true, taskId: "task-3", status: "INIT" })
    : Response.json({ success: true, status: "WAIT_USER", chunks: "[]" });
  const client = new NewtonClient({ ...credentials, fetchImpl, sleep: async () => {} });
  await assert.rejects(() => client.searchProducts("找一个瓶子"), (error: unknown) => {
    assert.ok(error instanceof NewtonApiError);
    assert.equal(error.code, "NEWTON_WAIT_USER");
    return true;
  });
});

test("creates a confirmed product inquiry with required Newton routing and safety controls", async () => {
  let requestBody: URLSearchParams | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestBody = new URLSearchParams(String(init?.body));
    return Response.json({ success: true, taskId: "inquiry-task", sessionId: "inquiry-session", status: "INIT" });
  };
  const client = new NewtonClient({ ...credentials, fetchImpl, now: () => 1_700_000_000_000 });
  const created = await client.createProductInquiryTask({
    products: [
      { itemId: "123", productUrl: "https://detail.1688.com/offer/123.html", title: "喷雾瓶" },
      { itemId: "456", productUrl: "https://detail.1688.com/offer/456.html", title: "喷雾瓶二号" },
    ],
    requirement: "采购 500 个，支持定制 logo",
    questions: ["500 个什么价格？", "多久发货？"],
    mode: "multi_round",
    timeoutMinutes: 30,
  });
  assert.equal(created.taskId, "inquiry-task");
  assert.equal(requestBody?.get("workflowName"), "1688-supplychain-procurement-inquiry");
  const message = requestBody?.get("message") ?? "";
  assert.match(message, /sendOriginal=true/);
  assert.match(message, /forceSkillId: 1688-supplychain-procurement/);
  assert.match(message, /多轮沟通/);
  assert.match(message, /不得下单、不得付款/);
  assert.match(message, /offer\/123/);
  assert.match(message, /offer\/456/);
  assert.equal(message.includes(credentials.accessToken), false);
});

test("normalizes wrapped batch inquiry replies without retaining the raw payload", () => {
  const normalized = normalizeInquiryResult({
    success: true,
    inquiryStatus: "SUCCESS",
    data: JSON.stringify({
      taskId: "task-4",
      thirdPartyTaskId: "ww-4",
      status: "SUCCESS",
      completed: true,
      subTasks: [{
        itemId: "123",
        sellerName: "测试工厂",
        topics: [{
          status: "SUCCESS",
          result: {
            aiSummary: "500 个单价 0.8 元，三天发货",
            conversation: [
              { id: "m1", role: "buyer", content: "500 个什么价格？", createdAt: "2026-09-17T00:00:00Z" },
              { id: "m2", role: "seller", content: "0.8 元，三天发货", createdAt: "2026-09-17T00:01:00Z" },
            ],
          },
        }],
      }],
    }),
  });
  assert.equal(normalized.completed, true);
  assert.equal(normalized.wwTaskId, "ww-4");
  assert.equal(normalized.targets[0].itemId, "123");
  assert.equal(normalized.targets[0].supplierName, "测试工厂");
  assert.equal(normalized.targets[0].messages[1].sender, "seller");
  assert.equal(normalized.targets[0].messages[1].content, "0.8 元，三天发货");
});

test("normalizes Newton imOfferModel dialogueList and millisecond timestamps", () => {
  const normalized = normalizeInquiryResult({
    success: true,
    inquiryStatus: "RUNNING",
    data: JSON.stringify({
      completed: false,
      status: "RUNNING",
      subTasks: [{
        offerId: 1065890562113,
        receiverMainLoginId: "升旺工艺徽章",
        shopUrl: "https://example.1688.com",
        topics: [{
          status: "SUCCESS",
          result: {
            summary: [{ question: "最小起订量", answer: "50个起订" }],
            answers: ["50个起订"],
          },
          imOfferModel: {
            dialogueList: [
              { role: "buyer", content: "最小起订量是多少", sendTime: 1789678731000 },
              { role: "seller", content: "50个起订", sendTime: 1789678735000 },
            ],
          },
        }],
      }],
    }),
  });
  assert.equal(normalized.targets[0].itemId, "1065890562113");
  assert.equal(normalized.targets[0].summary, "最小起订量：50个起订");
  assert.equal(normalized.targets[0].messages.length, 2);
  assert.equal(normalized.targets[0].messages[0].sender, "buyer");
  assert.equal(normalized.targets[0].messages[1].sender, "seller");
  assert.equal(normalized.targets[0].messages[1].content, "50个起订");
  assert.equal(normalized.targets[0].messages[1].sentAt, "2026-09-17T20:58:55.000Z");
});
