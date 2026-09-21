import { processKnowledgeQueue } from "../../../../../lib/knowledge/queue";
import { processFeishuSyncEvents } from "../../../../../lib/feishu/event-service";
import { getFeishuConfigurationStatus } from "../../../../../lib/feishu/config";
import { findFeishuKnowledgeWorkerUserId, syncDueFeishuScopes } from "../../../../../lib/feishu/sync-service";
import { syncDueFeishuDriveScopes } from "../../../../../lib/feishu/drive-service";
import { syncDueProcurementFollowUps } from "../../../../../lib/procurement/inquiries";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const expected = process.env.SUGAR_KNOWLEDGE_WORKER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || supplied !== expected) return Response.json({ error: "Knowledge worker authorization failed." }, { status: 401, headers });
  const results = await processKnowledgeQueue(3).catch(() => null);
  if (!results) return Response.json({ error: "Knowledge queue processing failed." }, { status: 500, headers });
  let feishuResults: Array<{ id: string; status: string }> = [];
  let feishuScheduledResults: Array<{ scopeId: string; ok: boolean }> = [];
  let feishuDriveScheduledResults: Array<{ scopeId: string; ok: boolean }> = [];
  const procurementFollowUpResults = await syncDueProcurementFollowUps(createAdminClient(), 5).catch(() => []);
  if (getFeishuConfigurationStatus().configured) {
    const requestedBy = await findFeishuKnowledgeWorkerUserId().catch(() => null);
    if (requestedBy) {
      feishuResults = await processFeishuSyncEvents({ requestedBy, limit: 5 }).catch(() => []);
      feishuScheduledResults = await syncDueFeishuScopes({ requestedBy, limit: 2 }).catch(() => []);
      feishuDriveScheduledResults = await syncDueFeishuDriveScopes({ requestedBy, limit: 1 }).catch(() => []);
    }
  }
  return Response.json({
    processed: results.length,
    results,
    feishuProcessed: feishuResults.length,
    feishuResults,
    feishuScheduledProcessed: feishuScheduledResults.length,
    feishuScheduledResults,
    feishuDriveScheduledProcessed: feishuDriveScheduledResults.length,
    feishuDriveScheduledResults,
    procurementFollowUpsProcessed: procurementFollowUpResults.length,
    procurementFollowUpResults,
  }, { headers });
}
