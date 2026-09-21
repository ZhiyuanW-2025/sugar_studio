import { createAdminClient } from "../../../../lib/supabase/admin";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  const { data, error } = await createAdminClient().from("runner_devices")
    .select("id,name,platform,app_version,status,paired_at,last_seen_at")
    .eq("user_id", user.id).order("paired_at", { ascending: false });
  if (error) return Response.json({ error: "暂时无法读取本地助手。" }, { status: 500, headers });
  return Response.json({ devices: data ?? [] }, { headers });
}
