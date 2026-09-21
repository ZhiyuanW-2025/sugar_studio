import { recordSecurityEvent } from "../../../../lib/account/security-events";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic"; const headers = { "Cache-Control": "no-store" }; const allowed = new Map([["image/png","png"],["image/jpeg","jpg"],["image/webp","webp"]]);
export async function POST(request: Request) {
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  const form = await request.formData().catch(() => null); const file = form?.get("avatar");
  if (!(file instanceof File) || !allowed.has(file.type) || file.size <= 0 || file.size > 5*1024*1024) return Response.json({ error: "请选择 5 MB 以内的 PNG、JPG 或 WebP 图片。" }, { status: 400, headers });
  const path = `${user.id}/avatar-${crypto.randomUUID()}.${allowed.get(file.type)}`;
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage.from("profile-avatars").upload(path,fileBytes,{ contentType:file.type,upsert:false });
  if (uploadError) return Response.json({ error: "头像上传失败。" }, { status: 500, headers });
  const { data } = supabase.storage.from("profile-avatars").getPublicUrl(path); const { data: profile } = await supabase.from("profiles").select("avatar_url").eq("id",user.id).maybeSingle();
  const { error } = await supabase.from("profiles").update({ avatar_url:data.publicUrl }).eq("id",user.id); if (error) { await supabase.storage.from("profile-avatars").remove([path]); return Response.json({ error:"头像保存失败。"},{status:500,headers}); }
  const previous = profile?.avatar_url?.split("/profile-avatars/")[1]; if (previous?.startsWith(`${user.id}/`)) await supabase.storage.from("profile-avatars").remove([decodeURIComponent(previous)]);
  await recordSecurityEvent(user.id,"avatar_updated","更新了个人头像"); return Response.json({ uploaded:true,avatarUrl:data.publicUrl },{headers});
}
