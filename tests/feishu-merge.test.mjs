import test from "node:test";
import assert from "node:assert/strict";
import { decideFeishuTextBlockMerge } from "../lib/feishu/merge.ts";

test("auto-merges when only other Feishu blocks changed", () => {
  const result = decideFeishuTextBlockMerge({
    blockId: "target",
    baseText: "原来的目标段落",
    liveBlocks: [
      { blockId: "other", text: "其他段落已经被人修改" },
      { blockId: "target", text: "原来的目标段落" },
    ],
  });
  assert.deepEqual(result, { kind: "safe", blockId: "target" });
});

test("requires human resolution when the same block changed", () => {
  const result = decideFeishuTextBlockMerge({
    blockId: "target",
    baseText: "原来的目标段落",
    liveBlocks: [{ blockId: "target", text: "人在飞书修改后的段落" }],
  });
  assert.equal(result.kind, "conflict");
  assert.equal(result.liveText, "人在飞书修改后的段落");
});

test("requires human resolution when the target block was deleted", () => {
  const result = decideFeishuTextBlockMerge({ blockId: "target", baseText: "原文", liveBlocks: [] });
  assert.deepEqual(result, { kind: "conflict", blockId: "target", liveText: null });
});
