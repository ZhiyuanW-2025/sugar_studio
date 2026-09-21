import { authenticateRunnerDevice } from "../../../../../../lib/runner/device-auth";
import { createAdminClient } from "../../../../../../lib/supabase/admin";
import { isUuid } from "../../../../../../lib/model-config/http";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ error: "任务参数无效。" }, { status: 400, headers });
  const device = await authenticateRunnerDevice(request);
  if (!device) return Response.json({ error: "Sugar Runner 设备认证失败。" }, { status: 401, headers });
  const body = await request.json().catch(() => null);
  const responseStatus = Number(body?.responseStatus);
  const responseBody = body?.responseBody;
  if (!Number.isInteger(responseStatus) || responseStatus < 100 || responseStatus > 599 || !responseBody || typeof responseBody !== "object") {
    return Response.json({ error: "任务结果无效。" }, { status: 400, headers });
  }
  const succeeded = responseStatus >= 200 && responseStatus < 300;
  const errorPayload = responseBody as { code?: unknown; error?: unknown };
  const { data, error } = await createAdminClient().from("runner_jobs").update({
    status: succeeded ? "succeeded" : "failed",
    response_body: responseBody,
    response_status: responseStatus,
    error_code: succeeded ? null : String(errorPayload.code || "runner_error").slice(0, 100),
    error_message: succeeded ? null : String(errorPayload.error || "Runner operation failed.").slice(0, 500),
    completed_at: new Date().toISOString(),
  }).eq("id", id).eq("device_id", device.id).eq("user_id", device.user_id).eq("status", "running").select("id").maybeSingle();
  if (error || !data) return Response.json({ error: "任务不存在或已经完成。" }, { status: 409, headers });
  return Response.json({ completed: true }, { headers });
}
