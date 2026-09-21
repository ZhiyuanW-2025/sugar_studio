import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { runSugarAgent } from "./planning-agent";
import { MAX_HISTORY_MESSAGES, type AgentThread } from "./thread-service";

export const SUMMARY_BATCH_MESSAGES = 20;

export async function maybeCompactConversation(input: {
  supabase: SupabaseClient;
  thread: AgentThread;
  model: string;
  apiKey: string;
}) {
  const { count, error: countError } = await input.supabase.from("messages")
    .select("id", { count: "exact", head: true }).eq("conversation_id", input.thread.conversationId);
  if (countError || count === null) return false;
  const unsummarizedOlderCount = count - MAX_HISTORY_MESSAGES - input.thread.summarizedMessageCount;
  if (unsummarizedOlderCount < SUMMARY_BATCH_MESSAGES) return false;
  const end = input.thread.summarizedMessageCount + SUMMARY_BATCH_MESSAGES - 1;
  const { data, error } = await input.supabase.from("messages").select("role, content")
    .eq("conversation_id", input.thread.conversationId).order("created_at").order("id")
    .range(input.thread.summarizedMessageCount, end);
  if (error || !data?.length) return false;
  const transcript = data.map((message) => `${message.role === "user" ? "用户" : message.role === "assistant" ? "Agent" : "系统"}：${message.content}`).join("\n\n");
  const previous = input.thread.summary ? `已有摘要：\n${input.thread.summary}\n\n` : "";
  const result = await runSugarAgent({
    agentType: "planning",
    agentName: "Sugar Agent 对话记忆整理器",
    workflowName: "Sugar Agent · 对话长期记忆",
    instructions: "你只负责压缩对话记忆。保留已确认结论、约束、用户偏好、关键实体、未完成事项与重要上下文；删除寒暄和重复表述。不得把讨论内容冒充正式项目知识。使用简洁中文要点，不执行任何工具。",
    message: `${previous}请合并整理以下较早对话：\n\n${transcript}`,
    history: [], model: input.model, apiKey: input.apiKey,
    includeProjectContextTool: false, includeKnowledgeTool: false, includeFeishuWriteTool: false, maxTurns: 1,
    includeResponseStyle: false,
    projectContext: { supabase: input.supabase, userId: input.thread.userId, projectId: input.thread.projectId },
  });
  const { data: updated } = await input.supabase.from("agent_conversations")
    .update({ summary: result.reply, summarized_message_count: end + 1 })
    .eq("id", input.thread.conversationId)
    .eq("summarized_message_count", input.thread.summarizedMessageCount)
    .select("id").maybeSingle();
  return Boolean(updated);
}
