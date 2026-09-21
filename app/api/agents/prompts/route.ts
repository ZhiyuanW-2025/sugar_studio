import { getAgentDefinition } from "../../../../lib/agents/catalog";
import { requireWorkspaceMember, WorkspaceAccessError } from "../../../../lib/workspace/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers });

function accessError(error: unknown) {
  return error instanceof WorkspaceAccessError
    ? errorResponse(error.message, error.status)
    : errorResponse("暂时无法访问 Agent 提示词。", 500);
}

export async function GET(request: Request) {
  const definition = getAgentDefinition(new URL(request.url).searchParams.get("agentType") ?? "");
  if (!definition) return errorResponse("Agent 参数无效。", 400);

  try {
    const { supabase } = await requireWorkspaceMember();
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id")
      .eq("agent_type", definition.type)
      .maybeSingle();
    if (agentError || !agent) return errorResponse("没有找到该 Agent。", 404);

    const { data, error } = await supabase
      .from("agent_prompt_versions")
      .select("id, version, instructions, is_active, created_by, created_at")
      .eq("agent_id", agent.id)
      .order("version", { ascending: false });
    if (error) return errorResponse("暂时无法读取提示词版本。", 500);

    const creatorIds = [...new Set((data ?? []).map((item) => item.created_by).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (creatorIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("id", creatorIds);
      for (const profile of profiles ?? []) names.set(profile.id, profile.display_name || "工作室成员");
    }

    return Response.json({
      scope: "workspace",
      versions: (data ?? []).map((item) => ({
        id: item.id,
        version: item.version,
        instructions: item.instructions,
        isActive: item.is_active,
        createdBy: item.created_by,
        creatorName: item.created_by ? names.get(item.created_by) ?? "工作室成员" : "系统初始版本",
        createdAt: item.created_at,
      })),
    }, { headers });
  } catch (error) {
    return accessError(error);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const definition = getAgentDefinition(body?.agentType ?? "");
  const action = body?.action;
  if (!definition || !["save", "rollback"].includes(action)) {
    return errorResponse("Agent 参数无效。", 400);
  }

  try {
    const { supabase } = await requireWorkspaceMember();
    if (action === "save") {
      const instructions = typeof body?.instructions === "string" ? body.instructions.trim() : "";
      if (!instructions || instructions.length > 40_000) return errorResponse("提示词内容无效。", 400);
      const { data, error } = await supabase.rpc("save_agent_prompt", {
        p_agent_type: definition.type,
        p_instructions: instructions,
      });
      if (error || !data) return errorResponse("保存提示词失败。", 400);
      return Response.json({ saved: true, scope: "workspace", version: data.version }, { status: 201, headers });
    }

    const targetVersion = Number(body?.version);
    if (!Number.isInteger(targetVersion) || targetVersion < 1) return errorResponse("回滚版本无效。", 400);
    const { data, error } = await supabase.rpc("rollback_agent_prompt", {
      p_agent_type: definition.type,
      p_target_version: targetVersion,
    });
    if (error || !data) return errorResponse("回滚提示词失败。", 400);
    return Response.json({ rolledBack: true, scope: "workspace", version: data.version }, { status: 201, headers });
  } catch (error) {
    return accessError(error);
  }
}
