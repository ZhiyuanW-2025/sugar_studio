import { isMarketingPlatform, isMarketingStatus } from "../../../../lib/marketing/types";
import { isUuid } from "../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function accessError(error: unknown) {
  if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
  return Response.json({ error: "营销内容更新失败，请稍后重试。" }, { status: 500, headers });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  if (!isUuid(id) || !isUuid(projectId)) return Response.json({ error: "营销内容参数无效。" }, { status: 400, headers });
  const updates: Record<string, unknown> = {};
  if (typeof body?.title === "string") {
    const value = body.title.trim();
    if (!value || value.length > 240) return Response.json({ error: "标题参数无效。" }, { status: 400, headers });
    updates.title = value;
  }
  if (typeof body?.content === "string") {
    const value = body.content.trim();
    if (!value || value.length > 100_000) return Response.json({ error: "正文参数无效。" }, { status: 400, headers });
    updates.content = value;
  }
  if (body?.platform !== undefined) {
    if (!isMarketingPlatform(body.platform)) return Response.json({ error: "平台参数无效。" }, { status: 400, headers });
    updates.platform = body.platform;
  }
  if (body?.status !== undefined) {
    if (!isMarketingStatus(body.status)) return Response.json({ error: "状态参数无效。" }, { status: 400, headers });
    updates.status = body.status;
  }
  if (typeof body?.summary === "string") updates.summary = body.summary.trim().slice(0, 2000);
  if (typeof body?.coverCopy === "string") updates.cover_copy = body.coverCopy.trim().slice(0, 1000);
  if (typeof body?.imagePlan === "string") updates.image_plan = body.imagePlan.trim().slice(0, 20_000);
  if (Array.isArray(body?.tags)) updates.tags = body.tags.filter((item: unknown) => typeof item === "string").slice(0, 30);
  if (Object.keys(updates).length === 0) return Response.json({ error: "没有需要更新的内容。" }, { status: 400, headers });

  try {
    const { supabase, user } = await requireProjectMember(projectId);
    updates.updated_by = user.id;
    const { data, error } = await supabase.from("marketing_contents").update(updates)
      .eq("id", id).eq("project_id", projectId).select("id,status,updated_at").maybeSingle();
    if (error || !data) return Response.json({ error: "营销内容更新失败。" }, { status: 500, headers });
    return Response.json({ updated: true, content: { id: data.id, status: data.status, updatedAt: data.updated_at } }, { headers });
  } catch (error) { return accessError(error); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  const projectId = new URL(_request.url).searchParams.get("projectId");
  if (!isUuid(id) || !isUuid(projectId)) return Response.json({ error: "营销内容参数无效。" }, { status: 400, headers });
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { data, error } = await supabase.from("marketing_contents").update({ status: "archived", updated_by: user.id })
      .eq("id", id).eq("project_id", projectId).select("id").maybeSingle();
    if (error || !data) return Response.json({ error: "营销内容归档失败。" }, { status: 500, headers });
    return Response.json({ archived: true }, { headers });
  } catch (error) { return accessError(error); }
}
