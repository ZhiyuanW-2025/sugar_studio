import "server-only";

import { createAdminClient } from "../supabase/admin";
import { indexKnowledgeDocument } from "./service";

export async function processKnowledgeQueue(limit = 3) {
  const admin = createAdminClient();
  const { data: jobs, error } = await admin.from("knowledge_ingestion_jobs")
    .select("id, document_id, requested_by").eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString()).not("requested_by", "is", null)
    .order("next_attempt_at").limit(Math.min(Math.max(limit, 1), 10));
  if (error) throw new Error("Knowledge queue lookup failed.");
  const results = [];
  for (const job of jobs ?? []) {
    try {
      const result = await indexKnowledgeDocument({ supabase: admin, userId: job.requested_by, documentId: job.document_id });
      results.push({ jobId: job.id, documentId: job.document_id, status: "completed", result });
    } catch {
      results.push({ jobId: job.id, documentId: job.document_id, status: "failed_or_retrying" });
    }
  }
  return results;
}
