import { WorkspaceAccessError, requireWorkspaceMember } from "../../../../../../lib/knowledge/access";
import { createAdminClient } from "../../../../../../lib/supabase/admin";
import { isUuid } from "../../../../../../lib/model-config/http";
import { nextWeeklySync } from "../../../../../../lib/feishu/scope-service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

async function allowedScope(id: string) {
  const { supabase } = await requireWorkspaceMember();
  const { data } = await supabase.from("feishu_sync_scopes").select("id, scope_type, project_id").eq("id", id).eq("enabled", true).maybeSingle();
  return data;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) return Response.json({ error: "连接参数无效。" }, { status: 400, headers });
    if (!await allowedScope(id)) return Response.json({ error: "没有找到可管理的飞书连接。" }, { status: 404, headers });
    const body = await request.json().catch(() => null);
    const frequency = body?.syncFrequency === "manual" ? "manual" : "weekly";
    const weekday = Number.isInteger(body?.syncWeekday) ? Math.min(Math.max(body.syncWeekday, 0), 6) : 1;
    const hour = Number.isInteger(body?.syncHourUtc) ? Math.min(Math.max(body.syncHourUtc, 0), 23) : 4;
    const { error } = await createAdminClient().from("feishu_sync_scopes").update({
      sync_frequency: frequency,
      sync_weekday: weekday,
      sync_hour_utc: hour,
      next_full_sync_at: frequency === "weekly" ? nextWeeklySync(weekday, hour) : new Date("9999-12-31T00:00:00.000Z").toISOString(),
    }).eq("id", id);
    if (error) throw new Error("FEISHU_SCOPE_UPDATE_FAILED");
    return Response.json({ updated: true }, { headers });
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status : 500;
    const message = error instanceof WorkspaceAccessError ? error.message : "暂时无法更新飞书同步设置。";
    return Response.json({ error: message }, { status, headers });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) return Response.json({ error: "连接参数无效。" }, { status: 400, headers });
    if (!await allowedScope(id)) return Response.json({ error: "没有找到可管理的飞书连接。" }, { status: 404, headers });
    const { error } = await createAdminClient().from("feishu_sync_scopes").update({ enabled: false }).eq("id", id);
    if (error) throw new Error("FEISHU_SCOPE_DISABLE_FAILED");
    return Response.json({ disabled: true }, { headers });
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status : 500;
    const message = error instanceof WorkspaceAccessError ? error.message : "暂时无法停用飞书连接。";
    return Response.json({ error: message }, { status, headers });
  }
}
