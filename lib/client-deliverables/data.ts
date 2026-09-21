import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type DocumentRow = {
  id: string; project_id: string; deliverable_type: string; title: string; audience: string; purpose: string;
  status: string; current_version_id: string | null; approved_version_id: string | null; approved_at: string | null;
  created_at: string; updated_at: string;
};
type VersionRow = { id: string; deliverable_id: string; version: number; content: string; change_summary: string; created_at: string };
type DispatchRow = { id: string; deliverable_id: string; channel: string; recipient: string; status: string; sent_at: string | null; failure_summary: string | null; created_at: string };

export async function loadClientDeliverables(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase.from("client_deliverables")
    .select("id, project_id, deliverable_type, title, audience, purpose, status, current_version_id, approved_version_id, created_by, approved_by, approved_at, created_at, updated_at")
    .eq("project_id", projectId).order("updated_at", { ascending: false });
  if (error) throw error;
  const documents = (data ?? []) as DocumentRow[];
  const versionIds = [...new Set(documents.flatMap((document) => [document.current_version_id, document.approved_version_id]).filter((id): id is string => Boolean(id)))];
  const { data: versions, error: versionError } = versionIds.length
    ? await supabase.from("client_deliverable_versions").select("id, deliverable_id, version, content, change_summary, created_at").in("id", versionIds)
    : { data: [], error: null };
  if (versionError) throw versionError;
  const versionRows = (versions ?? []) as VersionRow[];
  const versionById = new Map(versionRows.map((version) => [version.id, version]));
  const documentIds = documents.map((document) => document.id);
  const { data: dispatches, error: dispatchError } = documentIds.length
    ? await supabase.from("client_delivery_dispatches").select("id, deliverable_id, channel, recipient, status, sent_at, failure_summary, created_at").in("deliverable_id", documentIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (dispatchError) throw dispatchError;
  const dispatchRows = (dispatches ?? []) as DispatchRow[];
  return documents.map((document) => ({
    id: document.id,
    projectId: document.project_id,
    deliverableType: document.deliverable_type,
    title: document.title,
    audience: document.audience,
    purpose: document.purpose,
    status: document.status,
    currentVersion: document.current_version_id ? versionById.get(document.current_version_id) ?? null : null,
    approvedVersionId: document.approved_version_id,
    approvedAt: document.approved_at,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
    dispatches: dispatchRows.filter((dispatch) => dispatch.deliverable_id === document.id).map((dispatch) => ({
      id: dispatch.id, channel: dispatch.channel, recipient: dispatch.recipient, status: dispatch.status,
      sentAt: dispatch.sent_at, failureSummary: dispatch.failure_summary, createdAt: dispatch.created_at,
    })),
  }));
}
