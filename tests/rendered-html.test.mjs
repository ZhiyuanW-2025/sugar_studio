import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the authenticated application boundary", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Sugar Agent · 多 Agent 协作工作台<\/title>/i);
  assert.match(html, /进入工作台/);
  assert.match(html, /工作室成员专属空间/);
  assert.doesNotMatch(html, /SUPABASE_SECRET_KEY|OPENAI_API_KEY|FEISHU_APP_SECRET|FEISHU_VERIFICATION_TOKEN|SUGAR_GITHUB_TOKEN|SUGAR_CODEX_RUNNER_SECRET|SUGAR_KNOWLEDGE_WORKER_SECRET|RESEND_API_KEY|SUGAR_WECOM_WEBHOOK_URL|github_pat_|sk-[A-Za-z0-9_-]{8,}/);
});

test("keeps Agent runtimes and model secrets out of the client bundle", async () => {
  const assetRoot = new URL("../dist/client/assets/", import.meta.url);
  const assetNames = (await readdir(assetRoot)).filter((name) => name.endsWith(".js"));
  const clientJavaScript = (
    await Promise.all(assetNames.map((name) => readFile(new URL(name, assetRoot), "utf8")))
  ).join("\n");

  assert.doesNotMatch(clientJavaScript, /SUPABASE_SECRET_KEY|OPENAI_API_KEY|FEISHU_APP_SECRET|FEISHU_VERIFICATION_TOKEN|SUGAR_GITHUB_TOKEN|SUGAR_CODEX_RUNNER_SECRET|SUGAR_KNOWLEDGE_WORKER_SECRET|RESEND_API_KEY|SUGAR_WECOM_WEBHOOK_URL|github_pat_/);
  assert.doesNotMatch(clientJavaScript, /Sugar Agent · 策划师小花|负责活动概念、活动机制、路线、任务设计/);
  // The debug UI intentionally names the public tool, but its server-side
  // implementation and authorization errors must never enter the bundle.
  assert.doesNotMatch(clientJavaScript, /Project context access denied|Project context lookup failed/);
  assert.doesNotMatch(clientJavaScript, /resolve_user_image_model_config|api_key_secret_id|Generated image storage failed|Image edit source snapshot failed/);
  assert.doesNotMatch(clientJavaScript, /@openai\/agents/);
  assert.doesNotMatch(clientJavaScript, /openai\/resources\/images/);
});
