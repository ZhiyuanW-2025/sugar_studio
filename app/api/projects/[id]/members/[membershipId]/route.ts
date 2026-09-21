import { isUuid } from "../../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function PATCH(request: Request, context: { params: Promise<{ id: string; membershipId: string }> | { id: string; membershipId: string } }) {
  const { id, membershipId } = await context.params;
  const body = await request.json().catch(() => null);
  const role = body?.role;
  if (!isUuid(id) || !isUuid(membershipId) || !["project_lead", "member"].includes(role)) {
    return Response.json({ error: "成员参数无效。" }, { status: 400, headers });
  }
  try {
    const { supabase } = await requireProjectMember(id);
    const { error } = await supabase.rpc("update_project_member_role", {
      p_project_id: id,
      p_membership_id: membershipId,
      p_role: role,
    });
    if (error) return Response.json({ error: error.message.includes("at least one lead") ? "项目必须保留至少一位负责人。" : "成员身份更新失败。" }, { status: 400, headers });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "成员身份更新失败。" }, { status: 500, headers });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; membershipId: string }> | { id: string; membershipId: string } }) {
  const { id, membershipId } = await context.params;
  if (!isUuid(id) || !isUuid(membershipId)) return Response.json({ error: "成员参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(id);
    const { error } = await supabase.rpc("remove_project_member", {
      p_project_id: id,
      p_membership_id: membershipId,
    });
    if (error) {
      const message = error.message.includes("at least one lead") ? "项目必须保留至少一位负责人。"
        : error.message.includes("at least one member") ? "项目必须保留至少一位成员。"
          : "移除成员失败。";
      return Response.json({ error: message }, { status: 400, headers });
    }
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "移除成员失败。" }, { status: 500, headers });
  }
}
