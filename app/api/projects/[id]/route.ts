import { isUuid } from "../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";
import { toProjectView } from "../../../../lib/projects/view";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ error: "项目参数无效。" }, { status: 400, headers });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : null;
  const description = typeof body?.description === "string" ? body.description.trim() : null;
  const status = body?.status === "active" || body?.status === "archived" ? body.status : null;
  if (name !== null && (!name || name.length > 120)) return Response.json({ error: "项目名称无效。" }, { status: 400, headers });
  if (description !== null && description.length > 2000) return Response.json({ error: "项目简介过长。" }, { status: 400, headers });
  if (name === null && description === null && status === null) return Response.json({ error: "没有需要更新的内容。" }, { status: 400, headers });

  try {
    const { supabase, membership } = await requireProjectMember(id);
    const updates: Record<string, string | null> = {};
    if (name !== null) updates.name = name;
    if (description !== null) updates.description = description;
    if (status !== null) {
      updates.status = status;
      updates.archived_at = status === "archived" ? new Date().toISOString() : null;
    }
    const { data: project, error } = await supabase.from("projects").update(updates)
      .eq("id", id).select("id, name, description, status, project_kind").single();
    if (error || !project) return Response.json({ error: "项目更新失败。" }, { status: 500, headers });
    const { data: snapshot } = await supabase.from("project_snapshots")
      .select("summary, current_plan_summary, current_stage").eq("project_id", id).maybeSingle();
    return Response.json({ project: toProjectView(project, snapshot, membership.role) }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "项目更新失败。" }, { status: 500, headers });
  }
}
