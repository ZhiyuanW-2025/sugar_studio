import { getAgentDefinition } from "../../../../lib/agents/catalog";
import { resolveAgentToolConfigs } from "../../../../lib/agents/tool-config-service";
import { requireWorkspaceMember, WorkspaceAccessError } from "../../../../lib/workspace/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const responseError = (message: string, status: number) => Response.json({ error: message }, { status, headers });

function accessError(error: unknown) {
  return error instanceof WorkspaceAccessError ? responseError(error.message, error.status) : responseError("暂时无法访问 Agent 工具。", 500);
}

export async function GET(request: Request) {
  const agent = getAgentDefinition(new URL(request.url).searchParams.get("agentType") ?? "");
  if (!agent) return responseError("Agent 参数无效。", 400);
  try {
    const { supabase } = await requireWorkspaceMember();
    return Response.json({ scope: "workspace", tools: await resolveAgentToolConfigs(supabase, agent) }, { headers });
  } catch (error) { return accessError(error); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const agent = getAgentDefinition(String(body?.agentType ?? ""));
  const slug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const implementation = typeof body?.implementation === "string" ? body.implementation.trim() : "";
  const status = body?.status === "disabled" ? "disabled" : "enabled";
  const inputSchema = body?.inputSchema && typeof body.inputSchema === "object" && !Array.isArray(body.inputSchema) ? body.inputSchema : {};
  if (!agent || !/^[a-z0-9_]{2,96}$/.test(slug) || !name || name.length > 120 || description.length > 2000 || implementation.length > 20000) return responseError("工具定义不完整或格式无效。", 400);
  try {
    const { supabase, user } = await requireWorkspaceMember();
    const { data: agentRow, error: agentError } = await supabase.from("agents").select("id").eq("agent_type", agent.type).maybeSingle();
    if (agentError || !agentRow) return responseError("没有找到该 Agent。", 404);
    const { data, error } = await supabase.from("agent_tool_configs").upsert({
      agent_id: agentRow.id, slug, name, description, implementation, input_schema: inputSchema, status, created_by: user.id,
    }, { onConflict: "agent_id,slug" }).select("id").single();
    if (error || !data) return responseError("保存工具失败。", 400);
    return Response.json({ saved: true, id: data.id }, { status: 201, headers });
  } catch (error) { return accessError(error); }
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (typeof body?.id !== "string") return responseError("工具参数无效。", 400);
  try {
    const { supabase } = await requireWorkspaceMember();
    const { error } = await supabase.from("agent_tool_configs").delete().eq("id", body.id);
    if (error) return responseError("删除工具失败。", 400);
    return Response.json({ deleted: true }, { headers });
  } catch (error) { return accessError(error); }
}
