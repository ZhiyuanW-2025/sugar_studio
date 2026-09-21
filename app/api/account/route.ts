import { recordSecurityEvent } from "../../../lib/account/security-events";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic"; const headers = { "Cache-Control": "no-store" };
export async function GET() {
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  const [{ data: profile }, { data: memberships }, { data: securityEvents }] = await Promise.all([
    supabase.from("profiles").select("display_name, avatar_url, created_at, updated_at").eq("id", user.id).maybeSingle(),
    supabase.from("project_members").select("role, created_at, projects(id,name,status)").eq("user_id", user.id),
    supabase.from("account_security_events").select("id,event_type,summary,metadata,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
  ]);
  return Response.json({ user: { id: user.id, email: user.email, lastSignInAt: user.last_sign_in_at, createdAt: user.created_at }, profile: { displayName: profile?.display_name ?? "", avatarUrl: profile?.avatar_url ?? null, updatedAt: profile?.updated_at }, memberships: memberships ?? [], securityEvents: securityEvents ?? [] }, { headers });
}
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null); const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName || displayName.length > 80) return Response.json({ error: "请输入 1–80 个字符的姓名。" }, { status: 400, headers });
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", user.id); if (error) return Response.json({ error: "个人资料保存失败。" }, { status: 500, headers });
  await recordSecurityEvent(user.id, "profile_updated", "更新了显示姓名"); return Response.json({ updated: true }, { headers });
}
