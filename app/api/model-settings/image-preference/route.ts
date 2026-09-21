import { isImageModel } from "../../../../lib/image-generation/catalog";
import { isUuid } from "../../../../lib/model-config/http";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });

  const body = await request.json().catch(() => null);
  const model = body?.model;
  const credentialConfigId = body?.credentialConfigId;
  if (!isImageModel(model) || !isUuid(credentialConfigId)) {
    return Response.json({ error: "图片模型设置无效。" }, { status: 400, headers });
  }

  const { data: credential, error: credentialError } = await supabase
    .from("user_model_configs")
    .select("id, provider")
    .eq("id", credentialConfigId)
    .eq("user_id", user.id)
    .eq("provider", "openai")
    .maybeSingle();
  if (credentialError || !credential) {
    return Response.json({ error: "只能使用你自己的 OpenAI 凭证。" }, { status: 400, headers });
  }

  const { error } = await supabase.from("image_model_preferences").upsert(
    {
      user_id: user.id,
      provider: "openai",
      model,
      credential_config_id: credentialConfigId,
    },
    { onConflict: "user_id" },
  );
  if (error) return Response.json({ error: "保存图片模型设置失败。" }, { status: 400, headers });

  return Response.json({ ok: true }, { headers });
}
