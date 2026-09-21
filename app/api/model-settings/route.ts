import { createClient } from "../../../lib/supabase/server";
import { cleanApiKey, cleanModel, isModelProvider } from "../../../lib/model-config/http";
import { createModelConfig, listModelConfigs } from "../../../lib/model-config/service";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "请先登录。" }, { status: 401, headers: responseHeaders });
  }

  try {
    const [configs, preferencesResult, imagePreferenceResult] = await Promise.all([
      listModelConfigs(user.id),
      supabase
        .from("agent_model_preferences")
        .select("agent_type, model_config_id")
        .eq("user_id", user.id),
      supabase
        .from("image_model_preferences")
        .select("provider, model, credential_config_id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    if (preferencesResult.error || imagePreferenceResult.error) {
      return Response.json({ error: "读取模型偏好失败。" }, { status: 500, headers: responseHeaders });
    }

    return Response.json(
      {
        configs,
        preferences: (preferencesResult.data ?? []).map((preference) => ({
          agentType: preference.agent_type,
          modelConfigId: preference.model_config_id,
        })),
        imagePreference: imagePreferenceResult.data
          ? {
              provider: imagePreferenceResult.data.provider,
              model: imagePreferenceResult.data.model,
              credentialConfigId: imagePreferenceResult.data.credential_config_id,
            }
          : null,
      },
      { headers: responseHeaders },
    );
  } catch (error) {
    const isMissingServerKey =
      error instanceof Error && error.message === "Supabase server secret is not configured.";
    return Response.json(
      { error: isMissingServerKey ? "模型设置服务尚未完成服务端配置。" : "读取模型设置失败。" },
      { status: isMissingServerKey ? 503 : 500, headers: responseHeaders },
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "请先登录。" }, { status: 401, headers: responseHeaders });
  }

  const body = await request.json().catch(() => null);
  const provider = body && isModelProvider(body.provider) ? body.provider : null;
  const model = cleanModel(body?.model);
  const apiKey = cleanApiKey(body?.apiKey, true);
  const isDefault = body?.isDefault === true;

  if (!provider || !model || !apiKey) {
    return Response.json({ error: "请填写有效的提供商、模型和 API Key。" }, { status: 400, headers: responseHeaders });
  }

  try {
    const id = await createModelConfig({ userId: user.id, provider, model, apiKey, isDefault });
    return Response.json({ id }, { status: 201, headers: responseHeaders });
  } catch (error) {
    const isMissingServerKey =
      error instanceof Error && error.message === "Supabase server secret is not configured.";
    return Response.json(
      { error: isMissingServerKey ? "模型设置服务尚未完成服务端配置。" : "保存失败；请检查是否已配置相同模型。" },
      { status: isMissingServerKey ? 503 : 400, headers: responseHeaders },
    );
  }
}
