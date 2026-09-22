import { processKnowledgeQueue } from "../../../../../lib/knowledge/queue";
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
  const procurementFollowUpResults = await syncDueProcurementFollowUps(createAdminClient(), 5).catch(() => []);
  return Response.json({
    processed: results.length,
    results,
    feishuProcessingMode: "manual_confirmation",
    feishuProcessed: 0,
    feishuResults: [],
    feishuScheduledProcessed: 0,
    feishuScheduledResults: [],
    feishuDriveScheduledProcessed: 0,
    feishuDriveScheduledResults: [],
    procurementFollowUpsProcessed: procurementFollowUpResults.length,
    procurementFollowUpResults,
  }, { headers });
}
