import { getAgentDefinition } from "../../../../../lib/agents/catalog";
import { parseAgentSkillDefinition, skillTestCasesToDb } from "../../../../../lib/agents/skill-http";
import { isUuid } from "../../../../../lib/model-config/http";
import { requireWorkspaceMember, WorkspaceAccessError } from "../../../../../lib/workspace/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers });

async function access(skillId: string, agentType: string) {
  const definition = getAgentDefinition(agentType);
  if (!definition || !isUuid(skillId)) return { response: errorResponse("Skill 参数无效。", 400) } as const;
  const workspace = await requireWorkspaceMember();
  const { data } = await workspace.supabase.from("agent_skills").select("id,agents!inner(agent_type)").eq("id", skillId).maybeSingle();
  const joined = data?.agents as unknown as { agent_type?: string } | null;
  if (!data || joined?.agent_type !== definition.type) return { response: errorResponse("没有找到该 Skill。", 404) } as const;
  return { ...workspace, definition } as const;
}

export async function PATCH(request: Request, context: { params: Promise<{ skillId: string }> | { skillId: string } }) {
  const { skillId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const authorized = await access(skillId, String(body?.agentType ?? ""));
    if ("response" in authorized) return authorized.response;
    const { supabase, definition } = authorized;
    if (body?.action === "status") {
      const status = ["draft", "active", "disabled"].includes(String(body.status)) ? String(body.status) : "";
      if (!status) return errorResponse("Skill 状态无效。", 400);
      const { error } = await supabase.rpc("set_agent_skill_status", { p_skill_id: skillId, p_status: status });
      if (error) return errorResponse("更新 Skill 状态失败。", 400);
      return Response.json({ updated: true }, { headers });
    }
    if (body?.action === "rollback") {
      const version = Number(body.version);
      if (!Number.isInteger(version) || version < 1) return errorResponse("回滚版本无效。", 400);
      const { data, error } = await supabase.rpc("rollback_agent_skill", { p_skill_id: skillId, p_target_version: version });
      if (error || !data) return errorResponse("回滚 Skill 失败。", 400);
      return Response.json({ rolledBack: true, ...data }, { headers });
    }
    if (body?.action !== "save") return errorResponse("Skill 操作无效。", 400);
    const input = parseAgentSkillDefinition(definition.type, body);
    if (!input) return errorResponse("Skill 内容不完整或超出限制。", 400);
    const { data, error } = await supabase.rpc("save_agent_skill_version", {
      p_skill_id: skillId, p_name: input.name, p_description: input.description,
      p_trigger_description: input.triggerDescription, p_negative_triggers: input.negativeTriggers,
      p_instructions: input.instructions, p_output_requirements: input.outputRequirements,
      p_allowed_tools: input.allowedTools, p_reference_material: input.referenceMaterial,
      p_test_cases: skillTestCasesToDb(input.testCases), p_status: input.status,
    });
    if (error || !data) return errorResponse("保存 Skill 版本失败。", 400);
    return Response.json({ saved: true, ...data }, { headers });
  } catch (error) {
    return error instanceof WorkspaceAccessError ? errorResponse(error.message, error.status) : errorResponse("暂时无法修改 Skill。", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ skillId: string }> | { skillId: string } }) {
  const { skillId } = await context.params;
  const agentType = new URL(request.url).searchParams.get("agentType") ?? "";
  try {
    const authorized = await access(skillId, agentType);
    if ("response" in authorized) return authorized.response;
    const { data, error } = await authorized.supabase.rpc("delete_draft_agent_skill", { p_skill_id: skillId });
    if (error || !data) return errorResponse("只有草稿 Skill 可以删除。", 400);
    return Response.json({ deleted: true }, { headers });
  } catch (error) {
    return error instanceof WorkspaceAccessError ? errorResponse(error.message, error.status) : errorResponse("暂时无法删除 Skill。", 500);
  }
}
