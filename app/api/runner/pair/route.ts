import { createAdminClient } from "../../../../lib/supabase/admin";
import { randomToken, sha256 } from "../../../../lib/runner/security";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const code = String(body?.code || "").replace(/\D/g, "");
  const name = String(body?.deviceName || "").trim().slice(0, 80);
  const platform = String(body?.platform || "").trim().slice(0, 80) || null;
  const appVersion = String(body?.appVersion || "").trim().slice(0, 40) || null;
  if (!/^\d{8}$/.test(code) || !name) {
    return Response.json({ error: "配对信息无效。" }, { status: 400, headers });
  }

  const admin = createAdminClient();
  const token = randomToken();
  const { data: device, error } = await admin.rpc("exchange_runner_pairing_code", {
    p_code_hash: await sha256(code),
    p_token_hash: await sha256(token),
    p_name: name,
    p_platform: platform,
    p_app_version: appVersion,
  }).maybeSingle();
  if (error) return Response.json({ error: "暂时无法完成设备配对。" }, { status: 500, headers });
  if (!device) return Response.json({ error: "配对码无效或已过期，请在 Sugar Agent 中重新生成。" }, { status: 401, headers });
  const paired = device as { id: string; name: string };
  return Response.json({ deviceId: paired.id, deviceName: paired.name, deviceToken: token }, { headers });
}
