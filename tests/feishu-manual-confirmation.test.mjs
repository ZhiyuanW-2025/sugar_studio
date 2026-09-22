import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("project materials exposes an explicit Feishu change confirmation action", async () => {
  const component = await readFile(new URL("components/ProjectMaterialsPanel.tsx", root), "utf8");
  assert.match(component, /飞书中有 \{data\.pendingFeishuChanges\.documentCount\} 份材料发生变化/);
  assert.match(component, />\{confirmingChanges \? "正在同步…" : "确认同步"\}</);
  assert.match(component, /\/api\/projects\/materials\/feishu-changes/);
});

test("the confirmation endpoint checks project membership before syncing and indexing", async () => {
  const route = await readFile(new URL("app/api/projects/materials/feishu-changes/route.ts", root), "utf8");
  assert.match(route, /requireProjectMember\(projectId\)/);
  assert.match(route, /confirmPendingProjectFeishuChanges/);
  assert.match(route, /indexKnowledgeDocument/);
});

test("the background knowledge worker no longer consumes Feishu changes automatically", async () => {
  const route = await readFile(new URL("app/api/knowledge/jobs/process/route.ts", root), "utf8");
  assert.doesNotMatch(route, /processFeishuSyncEvents/);
  assert.doesNotMatch(route, /syncDueFeishuScopes/);
  assert.doesNotMatch(route, /syncDueFeishuDriveScopes/);
  assert.match(route, /manual_confirmation/);
});
