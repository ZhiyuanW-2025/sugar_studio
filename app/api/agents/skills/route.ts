import { getAgentDefinition } from "../../../../lib/agents/catalog";
import { parseAgentSkillDefinition, skillTestCasesToDb } from "../../../../lib/agents/skill-http";
import { requireWorkspaceMember, WorkspaceAccessError } from "../../../../lib/workspace/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers });

function accessError(error: unknown) {
  return error instanceof WorkspaceAccessError ? errorResponse(error.message, error.status) : errorResponse("暂时无法访问 Agent Skills。", 500);
}

export async function GET(request: Request) {
  const definition = getAgentDefinition(new URL(request.url).searchParams.get("agentType") ?? "");
  if (!definition) return errorResponse("Agent 参数无效。", 400);
  try {
    const { supabase } = await requireWorkspaceMember();
    const { data: agent } = await supabase.from("agents").select("id").eq("agent_type", definition.type).maybeSingle();
    if (!agent) return errorResponse("没有找到该 Agent。", 404);
    const { data: skills, error } = await supabase.from("agent_skills")
      .select("id,slug,status,created_by,created_at,updated_at")
      .eq("agent_id", agent.id).order("updated_at", { ascending: false });
    if (error) return errorResponse("暂时无法读取 Skills。", 500);
    const skillIds = (skills ?? []).map((skill) => skill.id);
    const { data: versions, error: versionsError } = skillIds.length
      ? await supabase.from("agent_skill_versions")
          .select("id,skill_id,version,name,description,trigger_description,negative_triggers,instructions,output_requirements,allowed_tools,reference_material,test_cases,is_active,created_by,created_at")
          .in("skill_id", skillIds).order("version", { ascending: false })
      : { data: [], error: null };
    if (versionsError) return errorResponse("暂时无法读取 Skill 版本。", 500);
    const creatorIds = [...new Set((versions ?? []).map((item) => item.created_by).filter(Boolean))] as string[];
    const creatorNames = new Map<string, string>();
    if (creatorIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id,display_name").in("id", creatorIds);
      for (const profile of profiles ?? []) creatorNames.set(profile.id, profile.display_name || "工作室成员");
    }
    const mapVersion = (version: NonNullable<typeof versions>[number]) => ({
      id: version.id,
      version: version.version,
      name: version.name,
      description: version.description,
      triggerDescription: version.trigger_description,
      negativeTriggers: version.negative_triggers,
      instructions: version.instructions,
      outputRequirements: version.output_requirements,
      allowedTools: version.allowed_tools ?? [],
      referenceMaterial: version.reference_material,
      testCases: {
        shouldTrigger: (version.test_cases as { should_trigger?: string[] } | null)?.should_trigger ?? [],
        shouldNotTrigger: (version.test_cases as { should_not_trigger?: string[] } | null)?.should_not_trigger ?? [],
      },
      isActive: version.is_active,
      creatorName: version.created_by ? creatorNames.get(version.created_by) ?? "工作室成员" : "系统初始版本",
      createdAt: version.created_at,
    });
    return Response.json({ scope: "workspace", skills: (skills ?? []).map((skill) => {
      const history = (versions ?? []).filter((version) => version.skill_id === skill.id).map(mapVersion);
      return { id: skill.id, slug: skill.slug, status: skill.status, createdAt: skill.created_at, updatedAt: skill.updated_at, activeVersion: history.find((version) => version.isActive) ?? null, versions: history };
    }) }, { headers });
  } catch (error) { return accessError(error); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const definition = getAgentDefinition(String(body?.agentType ?? ""));
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  if (!definition || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2 || slug.length > 64) return errorResponse("Skill 标识无效。", 400);
  const input = parseAgentSkillDefinition(definition.type, body);
  if (!input) return errorResponse("Skill 内容不完整或超出限制。", 400);
  try {
    const { supabase } = await requireWorkspaceMember();
    const { data, error } = await supabase.rpc("create_agent_skill", {
      p_agent_type: definition.type, p_slug: slug, p_name: input.name, p_description: input.description,
      p_trigger_description: input.triggerDescription, p_negative_triggers: input.negativeTriggers,
      p_instructions: input.instructions, p_output_requirements: input.outputRequirements,
      p_allowed_tools: input.allowedTools, p_reference_material: input.referenceMaterial,
      p_test_cases: skillTestCasesToDb(input.testCases), p_status: input.status,
    });
    if (error || !data) return errorResponse(error?.code === "23505" ? "这个 Agent 已经有同名 Skill 标识。" : "创建 Skill 失败。", 400);
    return Response.json({ created: true, ...data }, { status: 201, headers });
  } catch (error) { return accessError(error); }
}
