import { isUuid } from "../../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../../lib/projects/access";
import { createAdminClient } from "../../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const action = body?.action;
  if (!isUuid(id) || !isUuid(projectId) || !["end", "resume", "mark_read"].includes(action)) {
    return Response.json({ error: "跟进参数无效。" }, { status: 400, headers });
  }

  try {
    await requireProjectMember(projectId);
    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin.from("procurement_inquiry_targets")
      .select("id, procurement_inquiries!inner(project_id)")
      .eq("id", id)
      .eq("procurement_inquiries.project_id", projectId)
      .maybeSingle();
    if (targetError || !target) return Response.json({ error: "没有找到这条商家记录。" }, { status: 404, headers });

    const changes = action === "end"
      ? { follow_up_status: "ended", follow_up_ended_at: new Date().toISOString(), has_new_reply: false }
      : action === "resume"
        ? { follow_up_status: "active", follow_up_ended_at: null }
        : { has_new_reply: false };
    const { error } = await admin.from("procurement_inquiry_targets").update(changes).eq("id", id);
    if (error) return Response.json({ error: "暂时无法更新跟进状态。" }, { status: 500, headers });
    return Response.json({ updated: true, action }, { headers });
  } catch (error) {
    const status = error instanceof ProjectAccessError ? error.status : 500;
    return Response.json({ error: error instanceof ProjectAccessError ? error.message : "暂时无法更新跟进状态。" }, { status, headers });
  }
}
