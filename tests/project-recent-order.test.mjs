import assert from "node:assert/strict";
import test from "node:test";
import { orderProjectsByRecentConversation } from "../lib/projects/recent-order.ts";

test("orders projects by the current user's latest conversation", () => {
  const ordered = orderProjectsByRecentConversation([
    { name: "较早项目", status: "active", lastConversationAt: "2026-09-18T08:00:00.000Z" },
    { name: "未对话项目", status: "active", lastConversationAt: null },
    { name: "最近项目", status: "active", lastConversationAt: "2026-09-20T08:00:00.000Z" },
  ]);
  assert.deepEqual(ordered.map((project) => project.name), ["最近项目", "较早项目", "未对话项目"]);
});

test("does not mutate the source project list", () => {
  const source = [
    { name: "A", status: "active", lastConversationAt: null },
    { name: "B", status: "active", lastConversationAt: "2026-09-20T08:00:00.000Z" },
  ];
  orderProjectsByRecentConversation(source);
  assert.deepEqual(source.map((project) => project.name), ["A", "B"]);
});
