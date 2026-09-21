import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createAdminClient } from "../../../lib/supabase/admin";
import { createClient } from "../../../lib/supabase/server";

export async function GET(request:Request){const url=new URL(request.url);const tokenHash=url.searchParams.get("token_hash");const type=url.searchParams.get("type") as EmailOtpType|null;const next=url.searchParams.get("next")?.startsWith("/")?url.searchParams.get("next")!:"/";if(tokenHash&&type){const supabase=await createClient();const {data,error}=await supabase.auth.verifyOtp({type,token_hash:tokenHash});if(!error&&data.user){await createAdminClient().from("project_invitations").update({status:"accepted",accepted_at:new Date().toISOString()}).eq("auth_user_id",data.user.id).eq("status","pending");return NextResponse.redirect(new URL(next,url.origin));}}return NextResponse.redirect(new URL("/?authError=1",url.origin));}
