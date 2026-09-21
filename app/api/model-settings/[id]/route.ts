import { cleanApiKey, cleanModel, isModelProvider, isUuid } from "../../../../lib/model-config/http";
import { deleteModelConfig, updateModelConfig } from "../../../../lib/model-config/service";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "请先登录。" }, { status: 401, headers: responseHeaders });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!isUuid(id) || !body) {
    return Response.json({ error: "无效的模型配置。" }, { status: 400, headers: responseHeaders });
  }

  const provider = body.provider === undefined ? undefined : isModelProvider(body.provider) ? body.provider : null;
  const model = body.model === undefined ? undefined : cleanModel(body.model);
  const apiKey = cleanApiKey(body.apiKey, false);
  const isDefault = body.isDefault === true ? true : undefined;

  if (provider === null || model === null || apiKey === null) {
    return Response.json({ error: "提交的模型配置无效。" }, { status: 400, headers: responseHeaders });
  }
  if (provider === undefined && model === undefined && apiKey === undefined && isDefault === undefined) {
    return Response.json({ error: "没有需要更新的内容。" }, { status: 400, headers: responseHeaders });
  }

  try {
    await updateModelConfig({
      userId: user.id,
      configId: id,
      provider,
      model,
      apiKey,
      isDefault,
    });
    return Response.json({ ok: true }, { headers: responseHeaders });
  } catch (error) {
    const isMissingServerKey =
      error instanceof Error && error.message === "Supabase server secret is not configured.";
    return Response.json(
      { error: isMissingServerKey ? "模型设置服务尚未完成服务端配置。" : "更新模型配置失败。" },
      { status: isMissingServerKey ? 503 : 400, headers: responseHeaders },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "请先登录。" }, { status: 401, headers: responseHeaders });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return Response.json({ error: "无效的模型配置。" }, { status: 400, headers: responseHeaders });
  }

  try {
    await deleteModelConfig(user.id, id);
    return Response.json({ ok: true }, { headers: responseHeaders });
  } catch (error) {
    const isMissingServerKey =
      error instanceof Error && error.message === "Supabase server secret is not configured.";
    return Response.json(
      { error: isMissingServerKey ? "模型设置服务尚未完成服务端配置。" : "删除模型配置失败。" },
      { status: isMissingServerKey ? 503 : 400, headers: responseHeaders },
    );
  }
}
