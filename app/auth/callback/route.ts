import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";
export async function GET(request:Request){ const url=new URL(request.url); const code=url.searchParams.get("code"); const next=url.searchParams.get("next")?.startsWith("/")?url.searchParams.get("next")!:"/"; if(code){ const supabase=await createClient(); const {data}=await supabase.auth.exchangeCodeForSession(code); if(data.user){await createAdminClient().from("project_invitations").update({status:"accepted",accepted_at:new Date().toISOString()}).eq("auth_user_id",data.user.id).eq("status","pending");} } return NextResponse.redirect(new URL(next,url.origin)); }
