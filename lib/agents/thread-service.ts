import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelAgentType } from "../model-config/catalog";

export const MAX_HISTORY_MESSAGES = 20;
export const MAX_DISPLAY_MESSAGES = 100;

export type StoredMessageRole = "user" | "assistant" | "system";

export type StoredMessage = {
  id: string;
  role: StoredMessageRole;
  content: string;
  createdAt: string;
  durationMs: number | null;
};

export type AgentThread = {
  id: string;
  userId: string;
  projectId: string;
  agentType: ModelAgentType;
  title: string;
  conversationId: string;
  conversationTitle: string;
  summary: string;
  summarizedMessageCount: number;
  codexThreadId: string | null;
};

type ThreadRow = {
  id: string;
  user_id: string;
  project_id: string;
  agent_type: ModelAgentType;
  title: string;
  codex_thread_id: string | null;
};

type MessageRow = {
  id: string;
  request_id: string;
  role: StoredMessageRole;
  content: string;
  created_at: string;
  generation_duration_ms: number | null;
};

type ConversationRow = {
  id: string;
  thread_id: string;
  title: string;
  summary: string;
  summarized_message_count: number;
  codex_thread_id: string | null;
};

type StoredTurn = {
  userMessage: StoredMessage;
  assistantMessage: StoredMessage;
};

function mapThread(row: ThreadRow, conversation: ConversationRow): AgentThread {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    agentType: row.agent_type,
    title: row.title,
    conversationId: conversation.id,
    conversationTitle: conversation.title,
    summary: conversation.summary,
    summarizedMessageCount: conversation.summarized_message_count,
    codexThreadId: conversation.codex_thread_id ?? row.codex_thread_id,
  };
}

function mapMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    durationMs: row.generation_duration_ms,
  };
}

export async function findAgentThread(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  agentType: ModelAgentType,
  conversationId?: string | null,
): Promise<AgentThread | null> {
  const { data, error } = await supabase
    .from("agent_threads")
    .select("id, user_id, project_id, agent_type, title, codex_thread_id")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("agent_type", agentType)
    .maybeSingle();

  if (error) throw new Error("Thread lookup failed.");
  if (!data) return null;
  let conversationQuery = supabase.from("agent_conversations")
    .select("id, thread_id, title, summary, summarized_message_count, codex_thread_id")
    .eq("thread_id", data.id).eq("status", "active");
  conversationQuery = conversationId ? conversationQuery.eq("id", conversationId) : conversationQuery.eq("is_current", true);
  const { data: conversation, error: conversationError } = await conversationQuery.maybeSingle();
  if (conversationError) throw new Error("Conversation lookup failed.");
  return conversation ? mapThread(data as ThreadRow, conversation as ConversationRow) : null;
}

export async function getOrCreateAgentThread(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  agentType: ModelAgentType,
): Promise<AgentThread> {
  const existing = await findAgentThread(supabase, userId, projectId, agentType);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("agent_threads")
    .insert({
      user_id: userId,
      project_id: projectId,
      agent_type: agentType,
      title: agentType === "planning"
        ? "制作人小花"
        : agentType === "coding"
          ? "工程师牛牛"
          : agentType === "design"
            ? "艺术家小熊"
            : agentType === "client"
              ? "客户伙伴小雪"
              : agentType === "procurement"
                ? "金牌买手拉夫"
                : "宣传委员豆豆",
    })
    .select("id, user_id, project_id, agent_type, title, codex_thread_id")
    .maybeSingle();

  if (!error && data) {
    const created = await findAgentThread(supabase, userId, projectId, agentType);
    if (created) return created;
  }

  // A concurrent first message can win the unique-key race. Read the single
  // canonical thread after that transaction commits.
  if (error?.code === "23505") {
    const concurrent = await findAgentThread(supabase, userId, projectId, agentType);
    if (concurrent) return concurrent;
  }

  throw new Error("Thread creation failed.");
}

export async function setAgentCodexThreadId(
  supabase: SupabaseClient,
  threadId: string,
  userId: string,
  codexThreadId: string,
  conversationId?: string,
) {
  const thread = conversationId ? { conversationId } : await findOwnedConversationId(supabase, threadId, userId);
  const { data, error } = await supabase
    .from("agent_conversations")
    .update({ codex_thread_id: codexThreadId })
    .eq("id", thread.conversationId)
    .eq("thread_id", threadId)
    .select("id")
    .maybeSingle();

  if (error || !data) throw new Error("Codex thread persistence failed.");
}

async function findOwnedConversationId(supabase: SupabaseClient, threadId: string, userId: string) {
  const { data: thread } = await supabase.from("agent_threads").select("id").eq("id", threadId).eq("user_id", userId).eq("agent_type", "coding").maybeSingle();
  if (!thread) throw new Error("Codex thread persistence failed.");
  const { data } = await supabase.from("agent_conversations").select("id").eq("thread_id", threadId).eq("is_current", true).eq("status", "active").maybeSingle();
  if (!data) throw new Error("Codex conversation lookup failed.");
  return { conversationId: data.id };
}

async function readMessages(
  supabase: SupabaseClient,
  thread: AgentThread,
  limit: number,
): Promise<StoredMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, request_id, role, content, created_at, generation_duration_ms")
    .eq("thread_id", thread.id)
    .eq("conversation_id", thread.conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error) throw new Error("Message history lookup failed.");
  const roleOrder: Record<StoredMessageRole, number> = {
    system: 0,
    user: 1,
    assistant: 2,
  };
  return ((data ?? []) as MessageRow[])
    .sort((left, right) => {
      const timeDifference = Date.parse(left.created_at) - Date.parse(right.created_at);
      if (timeDifference !== 0) return timeDifference;
      if (left.request_id === right.request_id) {
        return roleOrder[left.role] - roleOrder[right.role];
      }
      return left.id.localeCompare(right.id);
    })
    .map(mapMessage);
}

export async function readModelHistory(supabase: SupabaseClient, thread: AgentThread) {
  const recent = await readMessages(supabase, thread, MAX_HISTORY_MESSAGES);
  return thread.summary
    ? [{ id: `summary-${thread.conversationId}`, role: "system" as const, content: `以下是更早对话的压缩摘要，仅用于延续讨论；若与正式项目数据冲突，以项目工具为准：\n${thread.summary}`, createdAt: new Date(0).toISOString(), durationMs: null }, ...recent]
    : recent;
}

export function readDisplayHistory(supabase: SupabaseClient, thread: AgentThread) {
  return readMessages(supabase, thread, MAX_DISPLAY_MESSAGES);
}

export async function findCompletedTurn(
  supabase: SupabaseClient,
  threadId: string,
  conversationId: string,
  requestId: string,
): Promise<StoredTurn | null> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, request_id, role, content, created_at, generation_duration_ms")
    .eq("thread_id", threadId)
    .eq("conversation_id", conversationId)
    .eq("request_id", requestId)
    .in("role", ["user", "assistant"]);

  if (error) throw new Error("Completed turn lookup failed.");
  const rows = (data ?? []) as MessageRow[];
  const user = rows.find((row) => row.role === "user");
  const assistant = rows.find((row) => row.role === "assistant");
  return user && assistant
    ? { userMessage: mapMessage(user), assistantMessage: mapMessage(assistant) }
    : null;
}

export async function appendCompletedTurn(
  supabase: SupabaseClient,
  input: {
    threadId: string;
    conversationId: string;
    requestId: string;
    userContent: string;
    assistantContent: string;
    assistantDurationMs: number;
  },
): Promise<StoredTurn> {
  const { data, error } = await supabase.rpc("append_agent_turn", {
    p_thread_id: input.threadId,
    p_conversation_id: input.conversationId,
    p_request_id: input.requestId,
    p_user_content: input.userContent,
    p_assistant_content: input.assistantContent,
    p_assistant_duration_ms: input.assistantDurationMs,
  });

  if (error || !data || typeof data !== "object") {
    throw new Error("Completed turn write failed.");
  }

  return data as StoredTurn;
}

export async function appendAssistantMessage(
  supabase: SupabaseClient,
  input: {
    threadId: string;
    conversationId: string;
    requestId: string;
    content: string;
    durationMs?: number;
  },
): Promise<StoredMessage> {
  const existing = await supabase.from("messages")
    .select("id, request_id, role, content, created_at, generation_duration_ms")
    .eq("thread_id", input.threadId)
    .eq("conversation_id", input.conversationId)
    .eq("request_id", input.requestId)
    .eq("role", "assistant")
    .maybeSingle();
  if (existing.error) throw new Error("Assistant message lookup failed.");
  if (existing.data) return mapMessage(existing.data as MessageRow);

  const { data, error } = await supabase.from("messages").insert({
    thread_id: input.threadId,
    conversation_id: input.conversationId,
    request_id: input.requestId,
    role: "assistant",
    content: input.content.trim(),
    generation_duration_ms: input.durationMs ?? null,
  }).select("id, request_id, role, content, created_at, generation_duration_ms").maybeSingle();
  if (error || !data) throw new Error("Assistant message write failed.");

  await Promise.all([
    supabase.from("agent_conversations").update({ updated_at: new Date().toISOString() }).eq("id", input.conversationId),
    supabase.from("agent_threads").update({ updated_at: new Date().toISOString() }).eq("id", input.threadId),
  ]);
  return mapMessage(data as MessageRow);
}
