import { isUuid } from "../../../../lib/model-config/http";
import { resolveModelConfig } from "../../../../lib/model-config/service";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { createClient } from "../../../../lib/supabase/server";
import { searchProjectKnowledge } from "../../../../lib/knowledge/search-service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const scope = ["all", "project", "company"].includes(body?.scope) ? body.scope as "all" | "project" | "company" : "all";
  if (!isUuid(projectId) || !query || query.length > 1000) return Response.json({ error: "请输入有效的知识检索问题。" }, { status: 400, headers });
  try {
    const started = Date.now();
    const { supabase, user } = await requireProjectMember(projectId);
    const model = await resolveModelConfig(user.id, "planning");
    if (model.provider !== "openai") return Response.json({ error: "当前知识检索只支持 OpenAI 向量模型。" }, { status: 422, headers });
    const results = await searchProjectKnowledge({ supabase, userId: user.id, projectId, apiKey: model.apiKey, query, scope, limit: 10 });
    const { data: event } = await createAdminClient().from("knowledge_search_events").insert({
      project_id: projectId, user_id: user.id, query_text: query, scope,
      result_count: results.length, top_score: results[0]?.score ?? null,
      latency_ms: Date.now() - started, result_chunk_ids: results.map((result) => result.chunkId),
    }).select("id").single();
    return Response.json({ searchId: event?.id ?? null, results }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof Error && error.message === "No model configuration is available for this user.") return Response.json({ error: "请先完成模型设置，再搜索知识库。" }, { status: 409, headers });
    return Response.json({ error: "知识检索失败，请稍后重试。" }, { status: 500, headers });
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const searchId = body?.searchId;
  const feedback = body?.feedback;
  if (!isUuid(searchId) || !["helpful", "not_helpful"].includes(feedback)) return Response.json({ error: "反馈参数无效。" }, { status: 400, headers });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  const { data, error } = await supabase.from("knowledge_search_events").update({ feedback }).eq("id", searchId).eq("user_id", user.id).select("id").maybeSingle();
  if (error || !data) return Response.json({ error: "反馈保存失败。" }, { status: 403, headers });
  return Response.json({ ok: true }, { headers });
}
