import { WorkspaceAccessError, requireWorkspaceMember } from "../../../../../lib/knowledge/access";
import { FeishuApiError } from "../../../../../lib/feishu/client";
import { FeishuConfigError } from "../../../../../lib/feishu/config";
import { syncFeishuKnowledge } from "../../../../../lib/feishu/sync-service";
import { isUuid } from "../../../../../lib/model-config/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireWorkspaceMember();
    const body = await request.json().catch(() => null);
    const scopeId = isUuid(body?.scopeId) ? body.scopeId as string : null;
    if (!scopeId) return Response.json({ error: "请选择要同步的飞书知识范围。" }, { status: 400, headers });
    const { data: scope } = await supabase.from("feishu_sync_scopes").select("id").eq("id", scopeId).eq("enabled", true).maybeSingle();
    if (!scope) return Response.json({ error: "你无权同步该飞书知识范围。" }, { status: 403, headers });
    const result = await syncFeishuKnowledge({ requestedBy: user.id, scopeId, force: body?.force === true });
    return Response.json(result, { headers });
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status
      : error instanceof FeishuConfigError ? 409
        : error instanceof FeishuApiError ? error.status === 403 ? 403 : 502
          : 500;
    const message = error instanceof WorkspaceAccessError || error instanceof FeishuConfigError || error instanceof FeishuApiError
      ? error.message
      : "飞书知识库同步失败，请稍后重试。";
    return Response.json({ error: message }, { status, headers });
  }
}
