import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { isUuid } from "@/lib/model-config/http";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function PATCH(request: Request, context: { params: Promise<{ testId: string; resultId: string }> }) {
  const { testId, resultId } = await context.params;
  const body = await request.json().catch(() => null);
  const score = body?.score;
  if (!isUuid(testId) || !isUuid(resultId) || !Number.isInteger(score) || score < 1 || score > 10) {
    return fail("评分必须是 1–10 的整数。", 400);
  }
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissingError(authError)) throw authError;
    if (!user) return fail("请先登录后继续。", 401);
    const { data: result, error: resultError } = await supabase
      .from("agent_test_run_results")
      .select("id,run_id")
      .eq("id", resultId)
      .maybeSingle();
    if (resultError || !result) return fail("没有找到测试结果。", 404);
    const { data: run, error: runError } = await supabase
      .from("agent_test_runs")
      .select("id")
      .eq("id", result.run_id)
      .eq("test_case_id", testId)
      .maybeSingle();
    if (runError || !run) return fail("测试结果不属于当前案例。", 404);
    const scoredAt = new Date().toISOString();
    const { error } = await supabase
      .from("agent_test_run_results")
      .update({ score, scored_at: scoredAt })
      .eq("id", resultId);
    if (error) throw error;
    return Response.json({ score, scoredAt }, { headers });
  } catch {
    return fail("保存评分失败。", 500);
  }
}
