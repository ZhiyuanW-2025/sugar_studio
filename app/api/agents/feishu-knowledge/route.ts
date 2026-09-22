import { getAgentDefinition } from "../../../../lib/agents/catalog";
import { createFeishuSyncScope } from "../../../../lib/feishu/scope-service";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { requireWorkspaceMember, WorkspaceAccessError } from "../../../../lib/workspace/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const errorResponse = (message: string, status: number) => Response.json({ error: message }, { status, headers });

function accessError(error: unknown) {
  return error instanceof WorkspaceAccessError
    ? errorResponse(error.message, error.status)
    : errorResponse("暂时无法访问 Agent 的飞书通用知识库。", 500);
}

export async function GET(request: Request) {
  const agent = getAgentDefinition(new URL(request.url).searchParams.get("agentType") ?? "");
  if (!agent) return errorResponse("Agent 参数无效。", 400);
  try {
    const { supabase } = await requireWorkspaceMember();
    const { data: row, error } = await supabase.from("agents")
      .select("general_feishu_scope_id")
      .eq("agent_type", agent.type)
      .maybeSingle();
    if (error) return errorResponse("暂时无法读取 Agent 飞书知识库连接。", 500);
    if (!row?.general_feishu_scope_id) return Response.json({ scope: null }, { headers });
    const { data: scope, error: scopeError } = await supabase.from("feishu_sync_scopes")
      .select("id, source_url, display_name, sync_frequency, last_full_sync_at, last_sync_status, last_sync_error")
      .eq("id", row.general_feishu_scope_id)
      .eq("enabled", true)
      .maybeSingle();
    if (scopeError) return errorResponse("暂时无法读取 Agent 飞书知识库连接。", 500);
    return Response.json({ scope: scope ?? null }, { headers });
  } catch (error) {
    return accessError(error);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const agent = getAgentDefinition(String(body?.agentType ?? ""));
  const sourceUrl = typeof body?.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  if (!agent || !sourceUrl) return errorResponse("请选择 Agent 并填写飞书知识库地址。", 400);
  try {
    const { user } = await requireWorkspaceMember();
    const scope = await createFeishuSyncScope({
      sourceUrl,
      scopeType: "company",
      projectId: null,
      createdBy: user.id,
      syncFrequency: body?.syncFrequency === "manual" ? "manual" : "weekly",
    });
    const { error } = await createAdminClient().from("agents")
      .update({ general_feishu_scope_id: scope.id })
      .eq("agent_type", agent.type);
    if (error) return errorResponse("飞书知识库已验证，但 Agent 连接保存失败。", 500);
    return Response.json({ scope }, { status: 201, headers });
  } catch (error) {
    return accessError(error);
  }
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const agent = getAgentDefinition(String(body?.agentType ?? ""));
  if (!agent) return errorResponse("Agent 参数无效。", 400);
  try {
    await requireWorkspaceMember();
    const { error } = await createAdminClient().from("agents")
      .update({ general_feishu_scope_id: null })
      .eq("agent_type", agent.type);
    if (error) return errorResponse("解除 Agent 飞书知识库失败。", 500);
    return Response.json({ disconnected: true }, { headers });
  } catch (error) {
    return accessError(error);
  }
}
