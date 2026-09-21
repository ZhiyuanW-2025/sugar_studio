import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { recordSecurityEvent } from "../../../../../lib/account/security-events";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ error: "项目参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(id);
    const { data: memberships, error } = await supabase.from("project_members")
      .select("id, user_id, role, created_at").eq("project_id", id).order("created_at");
    if (error) return Response.json({ error: "成员列表加载失败。" }, { status: 500, headers });
    const userIds = (memberships ?? []).map((item) => item.user_id);
    const { data: profiles } = userIds.length
      ? await supabase.from("profiles").select("id, display_name, avatar_url").in("id", userIds)
      : { data: [] };
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const admin = createAdminClient();
    const authUsers = await Promise.all(userIds.map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      return [userId, data.user?.email ?? ""] as const;
    }));
    const emailById = new Map(authUsers);
    const { data: invitations } = await supabase.from("project_invitations").select("id,email,role,status,expires_at,created_at").eq("project_id",id).eq("status","pending").order("created_at",{ascending:false});
    return Response.json({
      members: (memberships ?? []).map((membership) => ({
        id: membership.id,
        userId: membership.user_id,
        role: membership.role,
        createdAt: membership.created_at,
        displayName: profileById.get(membership.user_id)?.display_name || "项目成员",
        avatarUrl: profileById.get(membership.user_id)?.avatar_url || null,
        email: emailById.get(membership.user_id) || "",
      })), invitations: invitations ?? [],
    }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "成员列表加载失败。" }, { status: 500, headers });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const role = body?.role === "project_lead" ? "project_lead" : "member";
  if (!isUuid(id) || !email || email.length > 320) return Response.json({ error: "请输入有效邮箱。" }, { status: 400, headers });
  try {
    const { supabase, user } = await requireProjectMember(id);
    const { error } = await supabase.rpc("add_project_member_by_email", {
      p_project_id: id,
      p_email: email,
      p_role: role,
    });
    if (error) {
      if (!error.message.includes("not found")) {
        const message = error.message.includes("already") ? "该用户已经是项目成员。" : "添加项目成员失败。";
        return Response.json({ error: message }, { status: 400, headers });
      }
      const admin = createAdminClient();
      const redirectTo = `${new URL(request.url).origin}/auth/callback?next=/`;
      const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { display_name: email.split("@")[0] } });
      if (invited.error || !invited.data.user) return Response.json({ error: "邀请邮件发送失败，请检查 Supabase 邮件配置。" }, { status: 502, headers });
      const { error: membershipError } = await admin.from("project_members").insert({ project_id:id,user_id:invited.data.user.id,role });
      if (membershipError) { await admin.auth.admin.deleteUser(invited.data.user.id); return Response.json({error:"邀请已撤销：项目成员关系创建失败。"},{status:500,headers}); }
      await admin.from("project_invitations").insert({project_id:id,email:email.toLowerCase(),role,status:"pending",invited_by:user.id,auth_user_id:invited.data.user.id});
      await recordSecurityEvent(user.id,"project_invitation_sent",`向 ${email.toLowerCase()} 发送了项目邀请`,{projectId:id});
      return Response.json({ok:true,invited:true},{status:202,headers});
    }
    return Response.json({ ok: true, invited: false }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "添加项目成员失败。" }, { status: 500, headers });
  }
}
