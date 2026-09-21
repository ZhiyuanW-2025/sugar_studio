import { getOrCreateAgentThread } from "../../../lib/agents/thread-service";
import { isUuid } from "../../../lib/model-config/http";
import { modelAgentTypes, type ModelAgentType } from "../../../lib/model-config/catalog";
import { ProjectAccessError, requireProjectMember } from "../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const validAgent = (value: unknown): value is ModelAgentType => typeof value === "string" && modelAgentTypes.includes(value as ModelAgentType);

export async function GET(request: Request) {
  const url = new URL(request.url); const projectId = url.searchParams.get("projectId"); const agentType = url.searchParams.get("agentType");
  if (!isUuid(projectId) || !validAgent(agentType)) return Response.json({ error: "对话参数无效。" }, { status: 400, headers });
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { data: thread, error: threadError } = await supabase.from("agent_threads").select("id").eq("project_id", projectId).eq("user_id", user.id).eq("agent_type", agentType).maybeSingle();
    if (threadError) return Response.json({ error: "对话列表加载失败。" }, { status: 500, headers });
    if (!thread) return Response.json({ threadId: null, conversations: [] }, { headers });
    const { data, error } = await supabase.from("agent_conversations").select("id, title, status, is_current, summary, created_at, updated_at")
      .eq("thread_id", thread.id).order("updated_at", { ascending: false });
    if (error) return Response.json({ error: "对话列表加载失败。" }, { status: 500, headers });
    return Response.json({ threadId: thread.id, conversations: (data ?? []).map((item) => ({ id: item.id, title: item.title, status: item.status, isCurrent: item.is_current, hasSummary: Boolean(item.summary), createdAt: item.created_at, updatedAt: item.updated_at })) }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "对话列表加载失败。" }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null); const projectId = body?.projectId; const agentType = body?.agentType;
  const title = typeof body?.title === "string" ? body.title.trim() : "新对话";
  if (!isUuid(projectId) || !validAgent(agentType) || !title || title.length > 160) return Response.json({ error: "新对话参数无效。" }, { status: 400, headers });
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const thread = await getOrCreateAgentThread(supabase, user.id, projectId, agentType);
    const { data, error } = await supabase.rpc("create_agent_conversation", { p_thread_id: thread.id, p_title: title });
    if (error || !data) return Response.json({ error: "新对话创建失败。" }, { status: 500, headers });
    return Response.json({ created: true, conversation: { id: data.id, title: data.title, isCurrent: true, status: data.status } }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "新对话创建失败。" }, { status: 500, headers });
  }
}
