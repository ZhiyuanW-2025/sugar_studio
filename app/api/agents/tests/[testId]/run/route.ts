import { getAgentDefinition } from "../../../../../../lib/agents/catalog";
import { runAgentTestVersion } from "../../../../../../lib/agents/test-runner";
import type { AgentTestKnowledgeSource } from "../../../../../../lib/agents/test-workbench";
import { isUuid } from "../../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function POST(_request: Request, context: { params: Promise<{ testId: string }> }) {
  const { testId } = await context.params;
  if (!isUuid(testId)) return fail("测试案例无效。", 400);
  try {
    const initial = await import("../../../../../../lib/supabase/server").then(({ createClient }) => createClient());
    const { data: testCase, error: caseError } = await initial
      .from("agent_test_cases")
      .select("id,user_id,project_id,agent_type,title,prompt")
      .eq("id", testId)
      .maybeSingle();
    if (caseError || !testCase) return fail("没有找到测试案例。", 404);
    const { supabase, user } = await requireProjectMember(testCase.project_id);
    if (testCase.user_id !== user.id) return fail("你不能运行其他用户的测试。", 403);
    const definition = getAgentDefinition(testCase.agent_type);
    const prompt = typeof testCase.prompt === "string" ? testCase.prompt.trim() : "";
    if (!definition || !prompt) return fail("请先填写本次测试提示词。", 400);
    const { data: versions, error: versionError } = await supabase
      .from("agent_test_versions")
      .select("id,name,position,model_config_id,prompt_override,knowledge_sources,skill_slugs")
      .eq("test_case_id", testId)
      .order("position");
    if (versionError || !versions?.length) return fail("请至少添加一个测试版本。", 400);

    const { data: run, error: runError } = await supabase.from("agent_test_runs").insert({
      test_case_id: testId,
      started_by: user.id,
      prompt_snapshot: prompt,
      status: "running",
    }).select("id,started_at").single();
    if (runError || !run) throw runError ?? new Error("Missing test run.");

    const results = await Promise.all(versions.map(async (version) => {
      const startedAt = performance.now();
      const configSnapshot = {
        modelConfigId: version.model_config_id,
        promptOverride: version.prompt_override,
        knowledgeSources: version.knowledge_sources as AgentTestKnowledgeSource[],
        skillSlugs: version.skill_slugs as string[],
      };
      try {
        const output = await runAgentTestVersion({
          supabase,
          userId: user.id,
          projectId: testCase.project_id,
          agentType: definition.type,
          message: prompt,
          modelConfigId: version.model_config_id,
          promptOverride: version.prompt_override,
          knowledgeSources: version.knowledge_sources as AgentTestKnowledgeSource[],
          skillSlugs: version.skill_slugs as string[],
        });
        return {
          run_id: run.id,
          version_id: version.id,
          version_name: version.name,
          config_snapshot: configSnapshot,
          status: "completed",
          reply: output.reply,
          error_summary: null,
          tool_calls: output.toolCalls,
          loaded_skills: output.loadedSkills,
          model_provider: output.model.provider,
          model: output.model.model,
          prompt_source: output.prompt.source,
          prompt_version: output.prompt.version,
          duration_ms: Math.max(1, Math.round(performance.now() - startedAt)),
          trace_id: output.traceId,
          score: null,
          scored_at: null,
        };
      } catch (error) {
        const message = error instanceof Error && error.message.includes("model configuration")
          ? "此版本选择的模型配置不可用，请检查模型设置。"
          : "此版本暂时无法生成结果，请检查所选模型与知识条件后重试。";
        return {
          run_id: run.id,
          version_id: version.id,
          version_name: version.name,
          config_snapshot: configSnapshot,
          status: "failed",
          reply: null,
          error_summary: message,
          tool_calls: [],
          loaded_skills: version.skill_slugs as string[],
          model_provider: null,
          model: null,
          prompt_source: null,
          prompt_version: null,
          duration_ms: Math.max(1, Math.round(performance.now() - startedAt)),
          trace_id: null,
          score: null,
          scored_at: null,
        };
      }
    }));

    const { data: savedResults, error: resultError } = await supabase
      .from("agent_test_run_results")
      .insert(results)
      .select("*")
      .order("created_at");
    if (resultError) throw resultError;
    const runStatus = results.every((result) => result.status === "failed") ? "failed" : "completed";
    const completedAt = new Date().toISOString();
    await Promise.all([
      supabase.from("agent_test_runs").update({ status: runStatus, completed_at: completedAt }).eq("id", run.id),
      supabase.from("agent_test_cases").update({ updated_at: completedAt }).eq("id", testId),
    ]);
    return Response.json({
      run: {
        id: run.id,
        status: runStatus,
        prompt,
        startedAt: run.started_at,
        completedAt,
        results: (savedResults ?? []).map((result) => ({
          id: result.id,
          versionId: result.version_id,
          versionName: result.version_name,
          status: result.status,
          reply: result.reply,
          error: result.error_summary,
          toolCalls: result.tool_calls,
          loadedSkills: result.loaded_skills,
          modelProvider: result.model_provider,
          model: result.model,
          promptSource: result.prompt_source,
          promptVersion: result.prompt_version,
          durationMs: result.duration_ms,
          traceId: result.trace_id,
          score: result.score,
          scoredAt: result.scored_at,
          configSnapshot: result.config_snapshot,
        })),
      },
    }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    return fail("运行测试失败，请稍后重试。", 500);
  }
}
