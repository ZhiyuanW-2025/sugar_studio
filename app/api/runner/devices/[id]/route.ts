import { createAdminClient } from "../../../../../lib/supabase/admin";
import { createClient } from "../../../../../lib/supabase/server";
import { isUuid } from "../../../../../lib/model-config/http";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ error: "设备参数无效。" }, { status: 400, headers });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin.from("runner_devices").update({ status: "revoked", revoked_at: now })
    .eq("id", id).eq("user_id", user.id).eq("status", "active").select("id").maybeSingle();
  if (error || !data) return Response.json({ error: "设备不存在或已经停用。" }, { status: 404, headers });
  await admin.from("runner_jobs").update({
    status: "expired", completed_at: now, error_code: "device_revoked", error_message: "Runner device was revoked.",
  }).eq("device_id", id).in("status", ["queued", "running"]);
  return Response.json({ revoked: true }, { headers });
}
