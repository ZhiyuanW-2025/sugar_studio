import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { getAgentDefinition } from "../../../../lib/agents/catalog";
import { resolveActiveAgentSkills } from "../../../../lib/agents/skill-service";
import { resolveAgentTestPrompt } from "../../../../lib/agents/test-runner";
import {
  agentTestKnowledgeSources,
  maxAgentTestVersions,
  type AgentTestKnowledgeSource,
} from "../../../../lib/agents/test-workbench";
import { isUuid } from "../../../../lib/model-config/http";
import { listModelConfigs } from "../../../../lib/model-config/service";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
const sourceValues = new Set(agentTestKnowledgeSources.map((source) => source.value));

async function currentUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error && !isAuthSessionMissingError(error)) throw error;
  return { supabase, user };
}

function serializeVersion(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    modelConfigId: row.model_config_id,
    promptOverride: row.prompt_override,
    knowledgeSources: row.knowledge_sources,
    skillSlugs: row.skill_slugs,
  };
}

function serializeResult(row: Record<string, unknown>) {
  return {
    id: row.id,
    versionId: row.version_id,
    versionName: row.version_name,
    status: row.status,
    reply: row.reply,
    error: row.error_summary,
    toolCalls: row.tool_calls,
    loadedSkills: row.loaded_skills,
    modelProvider: row.model_provider,
    model: row.model,
    promptSource: row.prompt_source,
    promptVersion: row.prompt_version,
    durationMs: row.duration_ms,
    traceId: row.trace_id,
    score: row.score,
    scoredAt: row.scored_at,
    configSnapshot: row.config_snapshot,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const definition = getAgentDefinition(url.searchParams.get("agentType") ?? "");
  if (!definition) return fail("Agent 类型无效。", 400);
  try {
    const { supabase, user } = await currentUser();
    if (!user) return fail("请先登录后继续。", 401);
    const [{ data: cases, error: caseError }, models, skills, prompt] = await Promise.all([
      supabase
        .from("agent_test_cases")
        .select("id,project_id,agent_type,title,prompt,created_at,updated_at,projects(name)")
        .eq("user_id", user.id)
        .eq("agent_type", definition.type)
        .order("updated_at", { ascending: false }),
      listModelConfigs(user.id),
      resolveActiveAgentSkills(supabase, definition.type),
      resolveAgentTestPrompt(supabase, definition.type),
    ]);
    if (caseError) throw caseError;
    const caseRows = (cases ?? []) as unknown as Record<string, unknown>[];
    const caseIds = caseRows.map((row) => String(row.id));
    const versions = caseIds.length
      ? await supabase.from("agent_test_versions").select("*").in("test_case_id", caseIds).order("position")
      : { data: [], error: null };
    const runs = caseIds.length
      ? await supabase.from("agent_test_runs").select("*").in("test_case_id", caseIds).order("started_at", { ascending: false })
      : { data: [], error: null };
    if (versions.error || runs.error) throw versions.error ?? runs.error;

    const latestRunByCase = new Map<string, Record<string, unknown>>();
    for (const row of (runs.data ?? []) as Record<string, unknown>[]) {
      const testCaseId = String(row.test_case_id);
      if (!latestRunByCase.has(testCaseId)) latestRunByCase.set(testCaseId, row);
    }
    const latestRunIds = [...latestRunByCase.values()].map((row) => String(row.id));
    const results = latestRunIds.length
      ? await supabase.from("agent_test_run_results").select("*").in("run_id", latestRunIds).order("created_at")
      : { data: [], error: null };
    if (results.error) throw results.error;

    const payload = caseRows.map((row) => {
      const id = String(row.id);
      const latestRun = latestRunByCase.get(id);
      const projectRelation = row.projects as { name?: string } | { name?: string }[] | null;
      const projectName = Array.isArray(projectRelation) ? projectRelation[0]?.name : projectRelation?.name;
      return {
        id,
        projectId: row.project_id,
        projectName: projectName ?? "未知项目",
        agentType: row.agent_type,
        title: row.title,
        prompt: row.prompt,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        versions: ((versions.data ?? []) as Record<string, unknown>[])
          .filter((version) => version.test_case_id === id)
          .map(serializeVersion),
        latestRun: latestRun ? {
          id: latestRun.id,
          status: latestRun.status,
          prompt: latestRun.prompt_snapshot,
          startedAt: latestRun.started_at,
          completedAt: latestRun.completed_at,
          results: ((results.data ?? []) as Record<string, unknown>[])
            .filter((result) => result.run_id === latestRun.id)
            .map(serializeResult),
        } : null,
      };
    });

    return Response.json({
      cases: payload,
      catalog: {
        models: models.map((model) => ({ id: model.id, provider: model.provider, model: model.model, isDefault: model.isDefault })),
        skills: skills.map((skill) => ({ slug: skill.slug, name: skill.name, version: skill.version, description: skill.description })),
        prompt,
      },
    }, { headers });
  } catch {
    return fail("暂时无法读取测试案例。请确认数据库迁移已应用。", 500);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const definition = getAgentDefinition(body?.agentType ?? "");
  const projectId = body?.projectId;
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!definition || !isUuid(projectId)) return fail("新建测试参数无效。", 400);
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const skills = await resolveActiveAgentSkills(supabase, definition.type);
    const { data: testCase, error } = await supabase.from("agent_test_cases").insert({
      user_id: user.id,
      project_id: projectId,
      agent_type: definition.type,
      title: title || `未命名测试 · ${new Date().toLocaleDateString("zh-CN")}`,
      prompt: "",
    }).select("id").single();
    if (error || !testCase) throw error ?? new Error("Missing test case.");
    const { error: versionError } = await supabase.from("agent_test_versions").insert({
      test_case_id: testCase.id,
      name: "版本 A",
      position: 0,
      model_config_id: null,
      prompt_override: null,
      knowledge_sources: agentTestKnowledgeSources.map((source) => source.value),
      skill_slugs: skills.map((skill) => skill.slug),
    });
    if (versionError) throw versionError;
    return Response.json({ id: testCase.id }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    return fail("新建测试失败。", 500);
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const id = body?.id;
  const projectId = body?.projectId;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const inputVersions = Array.isArray(body?.versions) ? body.versions : [];
  if (!isUuid(id) || !isUuid(projectId) || !title || title.length > 120 || prompt.length > 8000 || inputVersions.length < 1 || inputVersions.length > maxAgentTestVersions) {
    return fail("测试配置无效。", 400);
  }
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { data: testCase } = await supabase.from("agent_test_cases").select("id,agent_type").eq("id", id).eq("user_id", user.id).maybeSingle();
    if (!testCase) return fail("没有找到测试案例。", 404);
    const definition = getAgentDefinition(testCase.agent_type);
    if (!definition) return fail("Agent 类型无效。", 400);
    const [models, skills, currentVersions] = await Promise.all([
      listModelConfigs(user.id),
      resolveActiveAgentSkills(supabase, definition.type),
      supabase.from("agent_test_versions").select("id").eq("test_case_id", id),
    ]);
    const modelIds = new Set(models.map((model) => model.id));
    const skillSlugs = new Set(skills.map((skill) => skill.slug));
    const normalized: {
      id: string | null;
      name: string;
      position: number;
      modelConfigId: string | null;
      promptOverride: string | null;
      knowledgeSources: AgentTestKnowledgeSource[];
      skillSlugs: string[];
    }[] = inputVersions.map((version: Record<string, unknown>, position: number) => ({
      id: typeof version.id === "string" && isUuid(version.id) ? version.id : null,
      name: typeof version.name === "string" ? version.name.trim().slice(0, 60) : "",
      position,
      modelConfigId: typeof version.modelConfigId === "string" && modelIds.has(version.modelConfigId) ? version.modelConfigId : null,
      promptOverride: typeof version.promptOverride === "string" && version.promptOverride.trim()
        ? version.promptOverride.trim().slice(0, 30000)
        : null,
      knowledgeSources: Array.isArray(version.knowledgeSources)
        ? [...new Set(version.knowledgeSources.filter((source): source is AgentTestKnowledgeSource => typeof source === "string" && sourceValues.has(source as AgentTestKnowledgeSource)))]
        : [],
      skillSlugs: Array.isArray(version.skillSlugs)
        ? [...new Set(version.skillSlugs.filter((slug): slug is string => typeof slug === "string" && skillSlugs.has(slug)))]
        : [],
    }));
    if (normalized.some((version) => !version.name)) return fail("每个测试版本都需要名称。", 400);

    const keepIds = new Set(normalized.flatMap((version) => version.id ? [version.id] : []));
    const removeIds = (currentVersions.data ?? []).map((version) => version.id).filter((versionId) => !keepIds.has(versionId));
    if (removeIds.length) {
      const { error } = await supabase.from("agent_test_versions").delete().in("id", removeIds);
      if (error) throw error;
    }
    for (const version of normalized) {
      const values = {
        name: version.name,
        position: version.position,
        model_config_id: version.modelConfigId,
        prompt_override: version.promptOverride,
        knowledge_sources: version.knowledgeSources,
        skill_slugs: version.skillSlugs,
      };
      if (version.id) {
        const { error } = await supabase.from("agent_test_versions").update(values).eq("id", version.id).eq("test_case_id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("agent_test_versions").insert({ test_case_id: id, ...values });
        if (error) throw error;
      }
    }
    const { error: updateError } = await supabase.from("agent_test_cases").update({ project_id: projectId, title, prompt }).eq("id", id);
    if (updateError) throw updateError;
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    return fail("保存测试配置失败。", 500);
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !isUuid(id)) return fail("测试案例无效。", 400);
  try {
    const { supabase, user } = await currentUser();
    if (!user) return fail("请先登录后继续。", 401);
    const { error } = await supabase.from("agent_test_cases").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return Response.json({ ok: true }, { headers });
  } catch {
    return fail("删除测试案例失败。", 500);
  }
}
