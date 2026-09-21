import { recordSecurityEvent } from "../../../../lib/account/security-events";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic="force-dynamic"; const headers={"Cache-Control":"no-store"};
export async function PATCH(request:Request){ const body=await request.json().catch(()=>null); const password=typeof body?.password==="string"?body.password:""; if(password.length<10||password.length>128)return Response.json({error:"新密码至少需要 10 个字符。"},{status:400,headers}); const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user)return Response.json({error:"请先登录。"},{status:401,headers}); const {error}=await supabase.auth.updateUser({password}); if(error)return Response.json({error:"密码更新失败；如登录时间较久，请重新登录后再试。"},{status:400,headers}); await recordSecurityEvent(user.id,"password_changed","修改了账户密码"); return Response.json({updated:true},{headers}); }
