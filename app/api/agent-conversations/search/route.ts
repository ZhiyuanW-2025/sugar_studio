import { isUuid } from "../../../../lib/model-config/http";
import { modelAgentTypes, type ModelAgentType } from "../../../../lib/model-config/catalog";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const url = new URL(request.url); const projectId = url.searchParams.get("projectId"); const agentType = url.searchParams.get("agentType"); const query = (url.searchParams.get("q") ?? "").trim();
  if (!isUuid(projectId) || !modelAgentTypes.includes(agentType as ModelAgentType) || !query || query.length > 500) return Response.json({ error: "搜索参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data, error } = await supabase.rpc("search_agent_conversations", { p_project_id: projectId, p_agent_type: agentType, p_query: query, p_limit: 20 });
    if (error) return Response.json({ error: "对话搜索失败。" }, { status: 500, headers });
    return Response.json({ results: (data ?? []).map((item: { conversation_id: string; conversation_title: string; message_id: string; role: string; content: string; created_at: string; rank: number }) => ({ conversationId: item.conversation_id, conversationTitle: item.conversation_title, messageId: item.message_id, role: item.role, content: item.content, createdAt: item.created_at, rank: item.rank })) }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "对话搜索失败。" }, { status: 500, headers });
  }
}
