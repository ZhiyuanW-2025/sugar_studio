import { recordSecurityEvent } from "../../../../lib/account/security-events";
import { createClient } from "../../../../lib/supabase/server";
export const dynamic="force-dynamic"; const headers={"Cache-Control":"no-store"};
export async function POST(){ const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user)return Response.json({error:"请先登录。"},{status:401,headers}); await recordSecurityEvent(user.id,"signed_out_all_devices","退出了所有设备上的登录会话"); const {error}=await supabase.auth.signOut({scope:"global"}); if(error)return Response.json({error:"退出所有设备失败。"},{status:500,headers}); return Response.json({signedOut:true},{headers}); }
