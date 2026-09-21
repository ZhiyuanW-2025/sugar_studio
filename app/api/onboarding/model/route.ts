import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });

  const { error } = await supabase
    .from("profiles")
    .update({ model_onboarding_completed_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    return Response.json({ error: "暂时无法完成首次设置，请稍后重试。" }, { status: 500, headers });
  }

  return Response.json({ ok: true }, { headers });
}
