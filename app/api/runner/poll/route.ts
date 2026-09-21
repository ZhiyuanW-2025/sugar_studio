import { authenticateRunnerDevice } from "../../../../lib/runner/device-auth";
import { resolveModelConfig } from "../../../../lib/model-config/service";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
type RunnerJobRow = { id: string; request_path: string; request_body: Record<string, unknown> };

export async function POST(request: Request) {
  const device = await authenticateRunnerDevice(request);
  if (!device) return Response.json({ error: "Sugar Runner 设备认证失败。" }, { status: 401, headers });
  const admin = createAdminClient();
  const { data: job, error } = await admin.rpc("claim_runner_job", { p_device_id: device.id }).maybeSingle();
  if (error) return Response.json({ error: "暂时无法领取任务。" }, { status: 500, headers });
  if (!job) return new Response(null, { status: 204, headers });
  const claimed = job as RunnerJobRow;

  let body = claimed.request_body;
  if (["/v1/codex/discuss", "/v1/coding-runs/execute"].includes(claimed.request_path)) {
    try {
      const model = await resolveModelConfig(device.user_id, "coding");
      if (model.provider !== "openai") throw new Error("Unsupported provider.");
      body = { ...body, model: model.model, apiKey: model.apiKey };
    } catch {
      await admin.from("runner_jobs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_code: "model_config_unavailable",
        error_message: "Coding model configuration is unavailable.",
      }).eq("id", claimed.id).eq("device_id", device.id);
      return new Response(null, { status: 204, headers });
    }
  }

  return Response.json({ jobId: claimed.id, path: claimed.request_path, body }, { headers });
}
