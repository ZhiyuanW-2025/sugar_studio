import "server-only";

import { createAdminClient } from "../supabase/admin";
import { syncFeishuKnowledge, syncFeishuNodeByToken } from "./sync-service";

export async function enqueueFeishuEvent(input: { eventId: string | null; eventType: string; objToken: string | null }) {
  const { error } = await createAdminClient().from("feishu_sync_events").upsert({
    event_id: input.eventId,
    event_type: input.eventType,
    obj_token: input.objToken,
    status: "pending",
  }, { onConflict: "event_id", ignoreDuplicates: true });
  if (error && !input.eventId) {
    const { error: insertError } = await createAdminClient().from("feishu_sync_events").insert({
      event_type: input.eventType,
      obj_token: input.objToken,
    });
    if (insertError) throw new Error("FEISHU_EVENT_ENQUEUE_FAILED");
  } else if (error) {
    throw new Error("FEISHU_EVENT_ENQUEUE_FAILED");
  }
}

export async function processFeishuSyncEvents(input: { requestedBy: string; limit?: number }) {
  const admin = createAdminClient();
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
  const { data: events, error } = await admin.from("feishu_sync_events")
    .select("id, obj_token, attempt_count")
    .eq("status", "pending")
    .order("created_at")
    .limit(limit);
  if (error) throw new Error("FEISHU_EVENT_LOOKUP_FAILED");
  const results: Array<{ id: string; status: string }> = [];
  let fullSyncRan = false;

  for (const event of events ?? []) {
    const { data: claimed } = await admin.from("feishu_sync_events")
      .update({ status: "processing", attempt_count: event.attempt_count + 1, error_message: null })
      .eq("id", event.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      const { data: mappings } = event.obj_token
        ? await admin.from("feishu_knowledge_documents").select("node_token, sync_scope_id").eq("obj_token", event.obj_token).not("sync_scope_id", "is", null)
        : { data: [] };
      if (mappings?.length) {
        for (const mapping of mappings) {
          await syncFeishuNodeByToken({ scopeId: mapping.sync_scope_id, nodeToken: mapping.node_token, requestedBy: input.requestedBy, force: true });
        }
      } else if (!fullSyncRan) {
        const { data: scopes } = await admin.from("feishu_sync_scopes").select("id").eq("enabled", true);
        for (const scope of scopes ?? []) await syncFeishuKnowledge({ requestedBy: input.requestedBy, scopeId: scope.id });
        fullSyncRan = true;
      }
      await admin.from("feishu_sync_events").update({
        status: "completed",
        processed_at: new Date().toISOString(),
        error_message: null,
      }).eq("id", event.id);
      results.push({ id: event.id, status: "completed" });
    } catch {
      const failedPermanently = event.attempt_count + 1 >= 3;
      await admin.from("feishu_sync_events").update({
        status: failedPermanently ? "failed" : "pending",
        error_message: "飞书文档增量同步失败。",
        processed_at: failedPermanently ? new Date().toISOString() : null,
      }).eq("id", event.id);
      results.push({ id: event.id, status: failedPermanently ? "failed" : "retrying" });
    }
  }
  return results;
}
