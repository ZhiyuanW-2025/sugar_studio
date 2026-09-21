import { isModelAgentType, isUuid } from "../../../../lib/model-config/http";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "请先登录。" }, { status: 401, headers: responseHeaders });
  }

  const body = await request.json().catch(() => null);
  const agentType = body?.agentType;
  const modelConfigId = body?.modelConfigId;
  if (!isModelAgentType(agentType) || (modelConfigId !== null && !isUuid(modelConfigId))) {
    return Response.json({ error: "无效的 Agent 模型偏好。" }, { status: 400, headers: responseHeaders });
  }

  if (modelConfigId === null) {
    const { error } = await supabase
      .from("agent_model_preferences")
      .delete()
      .eq("user_id", user.id)
      .eq("agent_type", agentType);
    if (error) {
      return Response.json({ error: "更新 Agent 模型偏好失败。" }, { status: 400, headers: responseHeaders });
    }
    return Response.json({ ok: true }, { headers: responseHeaders });
  }

  const { data: ownedConfig } = await supabase
    .from("user_model_configs")
    .select("id")
    .eq("id", modelConfigId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ownedConfig) {
    return Response.json({ error: "只能选择自己的模型配置。" }, { status: 400, headers: responseHeaders });
  }

  const { error } = await supabase.from("agent_model_preferences").upsert(
    {
      user_id: user.id,
      agent_type: agentType,
      model_config_id: modelConfigId,
    },
    { onConflict: "user_id,agent_type" },
  );
  if (error) {
    return Response.json({ error: "更新 Agent 模型偏好失败。" }, { status: 400, headers: responseHeaders });
  }

  return Response.json({ ok: true }, { headers: responseHeaders });
}
