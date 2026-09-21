import { createAdminClient } from "../../../../lib/supabase/admin";
import { createClient } from "../../../../lib/supabase/server";
import { createPairingCode, sha256 } from "../../../../lib/runner/security";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });

  const admin = createAdminClient();
  const code = createPairingCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  await admin.from("runner_pairing_codes").update({ used_at: now.toISOString() })
    .eq("user_id", user.id).is("used_at", null);
  const { error } = await admin.from("runner_pairing_codes").insert({
    user_id: user.id,
    code_hash: await sha256(code),
    expires_at: expiresAt.toISOString(),
  });
  if (error) return Response.json({ error: "暂时无法生成配对码。" }, { status: 500, headers });
  return Response.json({
    code: `${code.slice(0, 4)} ${code.slice(4)}`,
    expiresAt: expiresAt.toISOString(),
  }, { headers });
}
