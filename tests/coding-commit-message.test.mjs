import assert from "node:assert/strict";
import test from "node:test";
import { buildCodingCommitMessage } from "../lib/coding-runs/commit-message.ts";

test("builds the commit subject from the completed change instead of a user task title", () => {
  const message = buildCodingCommitMessage({
    implementationSummary: "已完成修改。\n\n变更文件：\n- `pages/index.css`\n\n改动：加深活动页背景遮罩并保持其他页面不变。",
    changedFiles: ["pages/index.css"],
  });
  assert.equal(message, "Sugar Agent: 加深活动页背景遮罩并保持其他页面不变");
});

test("falls back to the actual changed files when Codex returns only a generic completion", () => {
  assert.equal(buildCodingCommitMessage({
    implementationSummary: "已完成修改。",
    changedFiles: ["components/Panel.tsx"],
  }), "Sugar Agent: 更新 components/Panel.tsx");
});
