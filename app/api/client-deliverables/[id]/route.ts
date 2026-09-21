import { isUuid } from "../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const changeSummary = typeof body?.changeSummary === "string" ? body.changeSummary.trim() : "";
  if (!isUuid(id) || !isUuid(projectId) || !content || !changeSummary || content.length > 100_000 || changeSummary.length > 500) {
    return Response.json({ error: "材料版本参数无效。" }, { status: 400, headers });
  }
  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data: existing } = await supabase.from("client_deliverables").select("id").eq("id", id).eq("project_id", projectId).maybeSingle();
    if (!existing) return Response.json({ error: "没有找到该客户材料。" }, { status: 404, headers });
    const { data, error } = await supabase.rpc("append_client_deliverable_version", { p_deliverable_id: id, p_content: content, p_change_summary: changeSummary });
    if (error || !data) return Response.json({ error: "材料新版本保存失败。" }, { status: 500, headers });
    return Response.json({ saved: true, deliverable: data }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "材料新版本保存失败。" }, { status: 500, headers });
  }
}
