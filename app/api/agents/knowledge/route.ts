import { getAgentDefinition } from "../../../../lib/agents/catalog";
import { applyFeishuChangeProposal, createFeishuChangeProposal } from "../../../../lib/feishu/proposal-service";
import { indexKnowledgeDocument } from "../../../../lib/knowledge/service";
import { requireWorkspaceMember, WorkspaceAccessError } from "../../../../lib/workspace/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const responseError = (message: string, status: number) => Response.json({ error: message }, { status, headers });

function accessError(error: unknown) {
  return error instanceof WorkspaceAccessError ? responseError(error.message, error.status) : responseError("暂时无法访问 Agent 通用知识。", 500);
}

export async function GET(request: Request) {
  const agent = getAgentDefinition(new URL(request.url).searchParams.get("agentType") ?? "");
  if (!agent) return responseError("Agent 参数无效。", 400);
  try {
    const { supabase } = await requireWorkspaceMember();
    const { data: agentRow } = await supabase.from("agents").select("id").eq("agent_type", agent.type).maybeSingle();
    if (!agentRow) return responseError("没有找到该 Agent。", 404);
    const { data, error } = await supabase.from("agent_general_knowledge").select("id,title,content,status,created_at,updated_at").eq("agent_id", agentRow.id).order("updated_at", { ascending: false });
    if (error) return responseError("暂时无法读取 Agent 通用知识。", 500);
    return Response.json({ scope: "workspace", knowledge: data ?? [] }, { headers });
  } catch (error) { return accessError(error); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const agent = getAgentDefinition(String(body?.agentType ?? ""));
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const status = body?.status === "disabled" ? "disabled" : "active";
  if (!agent || !title || title.length > 160 || !content || content.length > 30000) return responseError("通用知识内容不完整或超出限制。", 400);
  try {
    const { supabase, user } = await requireWorkspaceMember();
    const { data: agentRow } = await supabase.from("agents").select("id").eq("agent_type", agent.type).maybeSingle();
    if (!agentRow) return responseError("没有找到该 Agent。", 404);
    if (!body?.id && body?.syncToFeishu === true) {
      const proposal = await createFeishuChangeProposal({
        requestedBy: user.id,
        projectId: null,
        agentType: agent.type,
        action: "create_document",
        documentTitle: `${agent.name} · ${title}`,
        changeSummary: `新增${agent.name}的通用工作知识`,
        content,
      });
      const applied = await applyFeishuChangeProposal({ proposalId: proposal.id, appliedBy: user.id });
      if (applied.synced?.documentId) {
        await indexKnowledgeDocument({ supabase, userId: user.id, documentId: applied.synced.documentId }).catch(() => undefined);
      }
    }
    const values = { agent_id: agentRow.id, title, content, status, created_by: user.id };
    const query = typeof body?.id === "string"
      ? supabase.from("agent_general_knowledge").update(values).eq("id", body.id)
      : supabase.from("agent_general_knowledge").insert(values);
    const { data, error } = await query.select("id").single();
    if (error || !data) return responseError("保存 Agent 通用知识失败。", 400);
    return Response.json({ saved: true, id: data.id }, { status: 201, headers });
  } catch (error) { return accessError(error); }
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (typeof body?.id !== "string") return responseError("知识参数无效。", 400);
  try {
    const { supabase } = await requireWorkspaceMember();
    const { error } = await supabase.from("agent_general_knowledge").delete().eq("id", body.id);
    if (error) return responseError("删除 Agent 通用知识失败。", 400);
    return Response.json({ deleted: true }, { headers });
  } catch (error) { return accessError(error); }
}
