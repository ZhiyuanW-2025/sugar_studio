import { WorkspaceAccessError, requireWorkspaceMember } from "../../../../../lib/knowledge/access";
import { getFeishuConfigurationStatus } from "../../../../../lib/feishu/config";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const { supabase } = await requireWorkspaceMember();
    const configuration = getFeishuConfigurationStatus();
    const { data: documents } = await supabase.from("feishu_knowledge_documents")
      .select("sync_status, last_synced_at")
      .order("last_synced_at", { ascending: false, nullsFirst: false });
    const { data: scopes } = await supabase.from("feishu_sync_scopes")
      .select("id, display_name, scope_type, project_id, last_sync_status, last_full_sync_at, next_full_sync_at")
      .eq("enabled", true).order("created_at", { ascending: false });
    const rows = documents ?? [];
    return Response.json({
      configuration,
      scopes: scopes ?? [],
      sync: {
        total: rows.length,
        ready: rows.filter((row) => row.sync_status === "ready").length,
        failed: rows.filter((row) => row.sync_status === "failed").length,
        unsupported: rows.filter((row) => row.sync_status === "unsupported").length,
        lastSyncedAt: rows.find((row) => row.last_synced_at)?.last_synced_at ?? null,
      },
    }, { headers });
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status : 500;
    const message = error instanceof WorkspaceAccessError ? error.message : "暂时无法读取飞书连接状态。";
    return Response.json({ error: message }, { status, headers });
  }
}
