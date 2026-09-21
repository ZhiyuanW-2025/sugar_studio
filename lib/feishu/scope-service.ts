import "server-only";

import { createAdminClient } from "../supabase/admin";
import { getFeishuSpace, getFeishuWikiNode, type FeishuScopeTarget } from "./client";
import { parseFeishuWikiUrl } from "./url";

export type FeishuKnowledgeScopeType = "company" | "project";

export type FeishuSyncScope = FeishuScopeTarget & {
  id: string;
  connectionId: string;
  scopeType: FeishuKnowledgeScopeType;
  projectId: string | null;
  sourceUrl: string;
  displayName: string;
  enabled: boolean;
  syncFrequency: "manual" | "weekly";
  syncWeekday: number;
  syncHourUtc: number;
  lastIncrementalSyncAt: string | null;
  lastFullSyncAt: string | null;
  nextFullSyncAt: string;
  lastSyncStatus: "pending" | "syncing" | "ready" | "failed";
  lastSyncError: string | null;
};

type ScopeRow = {
  id: string;
  connection_id: string;
  scope_type: FeishuKnowledgeScopeType;
  project_id: string | null;
  space_id: string;
  root_node_token: string | null;
  source_url: string;
  display_name: string;
  enabled: boolean;
  sync_frequency: "manual" | "weekly";
  sync_weekday: number;
  sync_hour_utc: number;
  last_incremental_sync_at: string | null;
  last_full_sync_at: string | null;
  next_full_sync_at: string;
  last_sync_status: FeishuSyncScope["lastSyncStatus"];
  last_sync_error: string | null;
};

export function mapFeishuScope(row: ScopeRow): FeishuSyncScope {
  return {
    id: row.id,
    connectionId: row.connection_id,
    scopeType: row.scope_type,
    projectId: row.project_id,
    spaceId: row.space_id,
    rootNodeToken: row.root_node_token,
    sourceUrl: row.source_url,
    displayName: row.display_name,
    enabled: row.enabled,
    syncFrequency: row.sync_frequency,
    syncWeekday: row.sync_weekday,
    syncHourUtc: row.sync_hour_utc,
    lastIncrementalSyncAt: row.last_incremental_sync_at,
    lastFullSyncAt: row.last_full_sync_at,
    nextFullSyncAt: row.next_full_sync_at,
    lastSyncStatus: row.last_sync_status,
    lastSyncError: row.last_sync_error,
  };
}

const scopeColumns = "id, connection_id, scope_type, project_id, space_id, root_node_token, source_url, display_name, enabled, sync_frequency, sync_weekday, sync_hour_utc, last_incremental_sync_at, last_full_sync_at, next_full_sync_at, last_sync_status, last_sync_error";

export function nextWeeklySync(weekday: number, hourUtc: number, from = new Date()) {
  const next = new Date(from);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(hourUtc);
  const days = (weekday - next.getUTCDay() + 7) % 7;
  next.setUTCDate(next.getUTCDate() + days);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 7);
  return next.toISOString();
}

export async function resolveFeishuScopeUrl(value: string) {
  const parsed = parseFeishuWikiUrl(value);
  let spaceId = parsed.spaceId;
  let rootNodeToken = parsed.rootNodeToken;
  let rootTitle: string | null = null;
  if (rootNodeToken) {
    const node = await getFeishuWikiNode(rootNodeToken, "");
    spaceId = node.spaceId;
    if (node.parentNodeToken) {
      rootTitle = node.title;
    } else {
      // A copied top-level/home-page link represents the whole knowledge
      // space. Keeping it as a subtree would silently omit sibling files.
      rootNodeToken = null;
    }
  }
  if (!spaceId) throw new Error("FEISHU_SCOPE_SPACE_MISSING");
  const space = await getFeishuSpace(spaceId);
  return {
    tenantUrl: parsed.tenantUrl,
    sourceUrl: parsed.sourceUrl,
    spaceId,
    rootNodeToken,
    displayName: rootTitle ? `${space.name} / ${rootTitle}` : space.name,
    spaceName: space.name,
    rootTitle,
  };
}

export async function createFeishuSyncScope(input: {
  sourceUrl: string;
  scopeType: FeishuKnowledgeScopeType;
  projectId: string | null;
  createdBy: string;
  syncFrequency?: "manual" | "weekly";
  syncWeekday?: number;
  syncHourUtc?: number;
}) {
  const resolved = await resolveFeishuScopeUrl(input.sourceUrl);
  const admin = createAdminClient();
  const { data: existingConnection } = await admin.from("feishu_connections")
    .select("id")
    .ilike("tenant_url", resolved.tenantUrl)
    .neq("status", "disabled")
    .limit(1)
    .maybeSingle();
  let connectionId = existingConnection?.id as string | undefined;
  if (!connectionId) {
    const { data, error } = await admin.from("feishu_connections").insert({
      name: resolved.spaceName,
      tenant_url: resolved.tenantUrl,
      status: "active",
      validated_at: new Date().toISOString(),
      created_by: input.createdBy,
    }).select("id").single();
    if (error || !data) throw new Error("FEISHU_CONNECTION_SAVE_FAILED");
    connectionId = data.id as string;
  } else {
    await admin.from("feishu_connections").update({ status: "active", validated_at: new Date().toISOString(), last_error: null }).eq("id", connectionId);
  }

  const root = resolved.rootNodeToken ?? "";
  let duplicateQuery = admin.from("feishu_sync_scopes").select(scopeColumns)
    .eq("connection_id", connectionId)
    .eq("space_id", resolved.spaceId)
    .eq("scope_type", input.scopeType)
    .eq("enabled", true);
  duplicateQuery = resolved.rootNodeToken ? duplicateQuery.eq("root_node_token", root) : duplicateQuery.is("root_node_token", null);
  duplicateQuery = input.projectId ? duplicateQuery.eq("project_id", input.projectId) : duplicateQuery.is("project_id", null);
  const { data: duplicate } = await duplicateQuery.maybeSingle();
  if (duplicate) return mapFeishuScope(duplicate as ScopeRow);

  const syncWeekday = Math.min(Math.max(input.syncWeekday ?? 1, 0), 6);
  const syncHourUtc = Math.min(Math.max(input.syncHourUtc ?? 4, 0), 23);
  const { data, error } = await admin.from("feishu_sync_scopes").insert({
    connection_id: connectionId,
    scope_type: input.scopeType,
    project_id: input.scopeType === "project" ? input.projectId : null,
    space_id: resolved.spaceId,
    root_node_token: resolved.rootNodeToken,
    source_url: resolved.sourceUrl,
    display_name: resolved.displayName,
    sync_frequency: input.syncFrequency ?? "weekly",
    sync_weekday: syncWeekday,
    sync_hour_utc: syncHourUtc,
    next_full_sync_at: nextWeeklySync(syncWeekday, syncHourUtc),
    last_sync_status: "pending",
    created_by: input.createdBy,
  }).select(scopeColumns).single();
  if (error || !data) throw new Error("FEISHU_SCOPE_SAVE_FAILED");
  return mapFeishuScope(data as ScopeRow);
}

export async function getFeishuSyncScope(scopeId: string) {
  const { data, error } = await createAdminClient().from("feishu_sync_scopes")
    .select(scopeColumns).eq("id", scopeId).eq("enabled", true).maybeSingle();
  if (error || !data) throw new Error("FEISHU_SCOPE_NOT_FOUND");
  return mapFeishuScope(data as ScopeRow);
}

export async function chooseFeishuSyncScope(projectId: string | null) {
  const admin = createAdminClient();
  if (projectId) {
    const { data } = await admin.from("feishu_sync_scopes").select(scopeColumns)
      .eq("scope_type", "project").eq("project_id", projectId).eq("enabled", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) return mapFeishuScope(data as ScopeRow);
  }
  const { data } = await admin.from("feishu_sync_scopes").select(scopeColumns)
    .eq("scope_type", "company").eq("enabled", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) throw new Error("FEISHU_SCOPE_NOT_FOUND");
  return mapFeishuScope(data as ScopeRow);
}
