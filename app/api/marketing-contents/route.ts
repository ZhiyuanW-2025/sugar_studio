import { isMarketingPlatform } from "../../../lib/marketing/types";
import { isUuid } from "../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function accessError(error: unknown) {
  if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
  return Response.json({ error: "营销内容操作失败，请稍后重试。" }, { status: 500, headers });
}

function serialize(item: Record<string, unknown>) {
  return {
    id: item.id,
    projectId: item.project_id,
    platform: item.platform,
    title: item.title,
    summary: item.summary,
    content: item.content,
    coverCopy: item.cover_copy,
    tags: item.tags,
    imagePlan: item.image_plan,
    status: item.status,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return Response.json({ error: "项目参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data, error } = await supabase.from("marketing_contents")
      .select("id,project_id,platform,title,summary,content,cover_copy,tags,image_plan,status,created_at,updated_at")
      .eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false });
    if (error) return Response.json({ error: "暂时无法加载营销内容。" }, { status: 500, headers });
    return Response.json({ contents: (data ?? []).map((item) => serialize(item)) }, { headers });
  } catch (error) { return accessError(error); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const platform = body?.platform;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!isUuid(projectId) || !isMarketingPlatform(platform) || !title || title.length > 240 || !content || content.length > 100_000) {
    return Response.json({ error: "营销内容参数无效。" }, { status: 400, headers });
  }
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { data, error } = await supabase.from("marketing_contents").insert({
      project_id: projectId,
      platform,
      title,
      content,
      summary: typeof body?.summary === "string" ? body.summary.trim().slice(0, 2000) : "",
      cover_copy: typeof body?.coverCopy === "string" ? body.coverCopy.trim().slice(0, 1000) : "",
      image_plan: typeof body?.imagePlan === "string" ? body.imagePlan.trim().slice(0, 20_000) : "",
      tags: Array.isArray(body?.tags) ? body.tags.filter((item: unknown) => typeof item === "string").slice(0, 30) : [],
      created_by: user.id,
      updated_by: user.id,
    }).select("id,project_id,platform,title,summary,content,cover_copy,tags,image_plan,status,created_at,updated_at").single();
    if (error || !data) return Response.json({ error: "营销草稿保存失败。" }, { status: 500, headers });
    return Response.json({ created: true, content: serialize(data) }, { status: 201, headers });
  } catch (error) { return accessError(error); }
}
