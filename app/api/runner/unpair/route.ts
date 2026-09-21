import { authenticateRunnerDevice } from "../../../../lib/runner/device-auth";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const device = await authenticateRunnerDevice(request);
  if (!device) return Response.json({ error: "Sugar Runner 设备认证失败。" }, { status: 401, headers });

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("runner_devices").update({
    status: "revoked",
    revoked_at: now,
  }).eq("id", device.id).eq("user_id", device.user_id).eq("status", "active");
  if (error) return Response.json({ error: "暂时无法解除设备配对。" }, { status: 500, headers });

  await admin.from("runner_jobs").update({
    status: "expired",
    completed_at: now,
    error_code: "device_revoked",
    error_message: "Runner device was revoked.",
  }).eq("device_id", device.id).in("status", ["queued", "running"]);

  return Response.json({ revoked: true }, { headers });
}
