import { WorkspaceAccessError, requireWorkspaceMember } from "../../../../../lib/knowledge/access";
import { FeishuApiError } from "../../../../../lib/feishu/client";
import { FeishuConfigError } from "../../../../../lib/feishu/config";
import { createFeishuSyncScope, resolveFeishuScopeUrl, type FeishuKnowledgeScopeType } from "../../../../../lib/feishu/scope-service";
import { FeishuUrlError } from "../../../../../lib/feishu/url";
import { isUuid } from "../../../../../lib/model-config/http";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function safeError(error: unknown) {
  if (error instanceof WorkspaceAccessError) return { status: error.status, message: error.message };
  if (error instanceof FeishuConfigError) return { status: 409, message: error.message };
  if (error instanceof FeishuUrlError) return { status: 400, message: error.message };
  if (error instanceof FeishuApiError) return { status: error.status === 403 ? 403 : 502, message: error.message };
  return { status: 500, message: "暂时无法保存飞书知识库连接。" };
}

export async function GET(request: Request) {
  try {
    const { supabase } = await requireWorkspaceMember();
    const projectId = new URL(request.url).searchParams.get("projectId");
    let query = supabase.from("feishu_sync_scopes")
      .select("id, connection_id, scope_type, project_id, space_id, root_node_token, source_url, display_name, enabled, sync_frequency, sync_weekday, sync_hour_utc, last_incremental_sync_at, last_full_sync_at, next_full_sync_at, last_sync_status, last_sync_error, created_at")
      .eq("enabled", true).order("created_at", { ascending: false });
    if (projectId && isUuid(projectId)) query = query.or(`scope_type.eq.company,project_id.eq.${projectId}`);
    const { data, error } = await query;
    if (error) throw new Error("FEISHU_SCOPES_LIST_FAILED");
    return Response.json({ scopes: data ?? [] }, { headers });
  } catch (error) {
    const safe = safeError(error);
    return Response.json({ error: safe.message }, { status: safe.status, headers });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireWorkspaceMember();
    const body = await request.json().catch(() => null);
    const sourceUrl = typeof body?.sourceUrl === "string" ? body.sourceUrl : "";
    const scopeType = body?.scopeType === "company" || body?.scopeType === "project" ? body.scopeType as FeishuKnowledgeScopeType : null;
    const projectId = isUuid(body?.projectId) ? body.projectId as string : null;
    if (!sourceUrl || !scopeType || (scopeType === "project" && !projectId)) {
      return Response.json({ error: "请选择知识范围并填写飞书知识库地址。" }, { status: 400, headers });
    }
    if (scopeType === "project") {
      const { data: membership } = await supabase.from("project_members").select("id")
        .eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
      if (!membership) return Response.json({ error: "你不是该项目成员。" }, { status: 403, headers });
    }
    if (body?.validateOnly === true) {
      const resolved = await resolveFeishuScopeUrl(sourceUrl);
      return Response.json({ resolved }, { headers });
    }
    const scope = await createFeishuSyncScope({
      sourceUrl,
      scopeType,
      projectId: scopeType === "project" ? projectId : null,
      createdBy: user.id,
      syncFrequency: body?.syncFrequency === "manual" ? "manual" : "weekly",
      syncWeekday: Number.isInteger(body?.syncWeekday) ? body.syncWeekday : 1,
      syncHourUtc: Number.isInteger(body?.syncHourUtc) ? body.syncHourUtc : 4,
    });
    return Response.json({ scope }, { status: 201, headers });
  } catch (error) {
    const safe = safeError(error);
    return Response.json({ error: safe.message }, { status: safe.status, headers });
  }
}
