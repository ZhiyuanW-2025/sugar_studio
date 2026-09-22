import "server-only";

import { createAdminClient } from "../supabase/admin";
import { syncFeishuKnowledge, syncFeishuNodeByToken } from "./sync-service";

export type PendingFeishuProjectChange = {
  id: string;
  title: string;
  sourceUrl: string | null;
  latestEventAt: string;
};

export type PendingFeishuProjectChanges = {
  eventCount: number;
  documentCount: number;
  latestEventAt: string | null;
  scopeIds: string[];
  documents: PendingFeishuProjectChange[];
};

type FeishuScopeSyncState = {
  id: string;
  last_incremental_sync_at: string | null;
  last_full_sync_at: string | null;
  last_sync_status: string;
};

type FeishuProjectDocument = {
  id: string;
  sync_scope_id: string | null;
  obj_token: string;
  title: string;
  source_url: string | null;
};

function latestSuccessfulSync(scope: FeishuScopeSyncState) {
  if (scope.last_sync_status === "failed") return null;
  const timestamps = [scope.last_incremental_sync_at, scope.last_full_sync_at]
    .filter(Boolean) as string[];
  return timestamps.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

export async function getPendingProjectFeishuChanges(projectId: string): Promise<PendingFeishuProjectChanges> {
  const admin = createAdminClient();
  const { data: events, error: eventError } = await admin.from("feishu_sync_events")
    .select("id,event_type,obj_token,created_at")
    .eq("status", "pending")
    .not("obj_token", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (eventError) throw new Error("FEISHU_EVENT_LOOKUP_FAILED");

  const objectTokens = [...new Set((events ?? []).flatMap((event) => event.obj_token ? [event.obj_token] : []))];
  if (objectTokens.length === 0) {
    return { eventCount: 0, documentCount: 0, latestEventAt: null, scopeIds: [], documents: [] };
  }

  const { data: documents, error: documentError } = await admin.from("feishu_knowledge_documents")
    .select("id,sync_scope_id,obj_token,title,source_url")
    .eq("project_id", projectId)
    .eq("scope_type", "project")
    .neq("sync_status", "removed")
    .in("obj_token", objectTokens);
  if (documentError) throw new Error("FEISHU_EVENT_DOCUMENT_LOOKUP_FAILED");

  const scopeIds = [...new Set((documents ?? []).flatMap((document) => document.sync_scope_id ? [document.sync_scope_id] : []))];
  if (scopeIds.length === 0) {
    return { eventCount: 0, documentCount: 0, latestEventAt: null, scopeIds: [], documents: [] };
  }
  const { data: scopes, error: scopeError } = await admin.from("feishu_sync_scopes")
    .select("id,last_incremental_sync_at,last_full_sync_at,last_sync_status")
    .eq("project_id", projectId)
    .eq("scope_type", "project")
    .eq("enabled", true)
    .in("id", scopeIds);
  if (scopeError) throw new Error("FEISHU_EVENT_SCOPE_LOOKUP_FAILED");

  const scopesById = new Map((scopes ?? []).map((scope) => [scope.id, scope as FeishuScopeSyncState]));
  const documentsByToken = new Map<string, FeishuProjectDocument[]>();
  for (const document of (documents ?? []) as FeishuProjectDocument[]) {
    const current = documentsByToken.get(document.obj_token) ?? [];
    current.push(document);
    documentsByToken.set(document.obj_token, current);
  }

  const pendingEventIds = new Set<string>();
  const affectedScopeIds = new Set<string>();
  const affectedDocuments = new Map<string, PendingFeishuProjectChange>();
  for (const event of events ?? []) {
    if (!event.obj_token) continue;
    for (const document of documentsByToken.get(event.obj_token) ?? []) {
      if (!document.sync_scope_id) continue;
      const scope = scopesById.get(document.sync_scope_id);
      if (!scope) continue;
      const syncedAt = latestSuccessfulSync(scope);
      if (syncedAt && Date.parse(event.created_at) <= Date.parse(syncedAt)) continue;
      pendingEventIds.add(event.id);
      affectedScopeIds.add(document.sync_scope_id);
      const existing = affectedDocuments.get(document.id);
      if (!existing || Date.parse(event.created_at) > Date.parse(existing.latestEventAt)) {
        affectedDocuments.set(document.id, {
          id: document.id,
          title: document.title,
          sourceUrl: document.source_url,
          latestEventAt: event.created_at,
        });
      }
    }
  }

  const pendingDocuments = [...affectedDocuments.values()]
    .sort((a, b) => Date.parse(b.latestEventAt) - Date.parse(a.latestEventAt));
  return {
    eventCount: pendingEventIds.size,
    documentCount: pendingDocuments.length,
    latestEventAt: pendingDocuments[0]?.latestEventAt ?? null,
    scopeIds: [...affectedScopeIds],
    documents: pendingDocuments,
  };
}

export async function confirmPendingProjectFeishuChanges(input: { projectId: string; requestedBy: string }) {
  const pending = await getPendingProjectFeishuChanges(input.projectId);
  const results = [];
  for (const scopeId of pending.scopeIds) {
    results.push(await syncFeishuKnowledge({ requestedBy: input.requestedBy, scopeId, force: false }));
  }
  return {
    pending,
    synced: results.reduce((total, result) => total + result.synced, 0),
    unchanged: results.reduce((total, result) => total + result.unchanged, 0),
    unsupported: results.reduce((total, result) => total + result.unsupported, 0),
    failed: results.reduce((total, result) => total + result.failed, 0),
    documentIds: [...new Set(results.flatMap((result) => result.documentIds))],
  };
}

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
