import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { KNOWLEDGE_DEFAULT_MATCH_COUNT, KNOWLEDGE_MAX_MATCH_COUNT } from "./config";
import { createKnowledgeEmbeddings, toPostgresVector } from "./embeddings";
import type { KnowledgeScope, KnowledgeSearchResult } from "./types";

type SearchRow = {
  chunk_id: string;
  document_id: string;
  scope: KnowledgeScope;
  file_id: string;
  file_name: string;
  content: string;
  page_number: number | null;
  section_title: string | null;
  combined_score: number;
};

type DriveSearchRow = {
  item_id: string;
  file_name: string;
  item_type: "folder" | "image" | "audio" | "video" | "other";
  path_text: string;
  content_summary: string;
  source_url: string | null;
  combined_score: number;
};

export async function searchProjectKnowledge(input: {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  apiKey: string;
  query: string;
  scope?: "all" | KnowledgeScope;
  limit?: number;
}): Promise<KnowledgeSearchResult[]> {
  const query = input.query.trim().slice(0, 1_000);
  if (!query) return [];

  const { data: membership, error: membershipError } = await input.supabase
    .from("project_members")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (membershipError || !membership) throw new Error("Knowledge access denied.");

  const [projectDocuments, companyDocuments, driveItems] = await Promise.all([
    input.scope === "company"
      ? Promise.resolve({ data: [] as { id: string }[], error: null })
      : input.supabase
          .from("knowledge_documents")
          .select("id")
          .eq("scope", "project")
          .eq("project_id", input.projectId)
          .eq("status", "ready")
          .limit(1),
    input.scope === "project"
      ? Promise.resolve({ data: [] as { id: string }[], error: null })
      : input.supabase
          .from("knowledge_documents")
          .select("id")
          .eq("scope", "company")
          .eq("status", "ready")
          .limit(1),
    input.scope === "company"
      ? Promise.resolve({ data: [] as { id: string }[], error: null })
      : input.supabase.from("feishu_drive_items").select("id").eq("project_id", input.projectId)
          .in("index_status", ["ready", "metadata_only"]).limit(1),
  ]);
  if (projectDocuments.error || companyDocuments.error || driveItems.error) throw new Error("Knowledge availability lookup failed.");
  if (!(projectDocuments.data?.length || companyDocuments.data?.length || driveItems.data?.length)) return [];

  const [embedding] = await createKnowledgeEmbeddings({ apiKey: input.apiKey, texts: [query] });
  const limit = Math.min(Math.max(input.limit ?? KNOWLEDGE_DEFAULT_MATCH_COUNT, 1), KNOWLEDGE_MAX_MATCH_COUNT);
  const admin = createAdminClient();
  const [documentMatches, driveMatches] = await Promise.all([
    admin.rpc("match_knowledge_chunks", {
      p_project_id: input.projectId,
      p_query_text: query,
      p_query_embedding: toPostgresVector(embedding),
      p_scope: input.scope ?? "all",
      p_match_count: limit,
    }),
    input.scope === "company" ? Promise.resolve({ data: [], error: null }) : admin.rpc("match_feishu_drive_items", {
      p_project_id: input.projectId,
      p_query_text: query,
      p_query_embedding: toPostgresVector(embedding),
      p_match_count: limit,
    }),
  ]);
  if (documentMatches.error || driveMatches.error) throw new Error("Knowledge search failed.");

  const rows = (documentMatches.data ?? []) as SearchRow[];
  const documentIds = [...new Set(rows.map((row) => row.document_id))];
  const companyFileIds = [...new Set(rows.filter((row) => row.scope === "company").map((row) => row.file_id))];
  const projectFileIds = [...new Set(rows.filter((row) => row.scope === "project").map((row) => row.file_id))];
  const sources = new Map<string, { source_provider: "upload" | "feishu"; source_url: string | null }>();
  const descriptions = new Map<string, { user_description: string; agent_summary: string }>();
  const [companySourceRows, projectSourceRows, descriptionRows] = await Promise.all([
    companyFileIds.length > 0
      ? createAdminClient().from("company_files").select("id, source_provider, source_url").in("id", companyFileIds)
      : Promise.resolve({ data: [], error: null }),
    projectFileIds.length > 0
      ? createAdminClient().from("project_files").select("id, source_provider, source_url").in("id", projectFileIds)
      : Promise.resolve({ data: [], error: null }),
    documentIds.length > 0
      ? createAdminClient().from("knowledge_documents").select("id, user_description, agent_summary").in("id", documentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (companySourceRows.error || projectSourceRows.error || descriptionRows.error) throw new Error("Knowledge source lookup failed.");
  for (const sourceRows of [companySourceRows.data, projectSourceRows.data]) {
    for (const source of sourceRows ?? []) sources.set(source.id, {
      source_provider: source.source_provider === "feishu" ? "feishu" : "upload",
      source_url: source.source_url,
    });
  }
  for (const description of descriptionRows.data ?? []) descriptions.set(description.id, {
    user_description: description.user_description ?? "",
    agent_summary: description.agent_summary ?? "",
  });

  const documentResults: KnowledgeSearchResult[] = rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    scope: row.scope,
    fileId: row.file_id,
    fileName: row.file_name,
    content: row.content,
    pageNumber: row.page_number,
    sectionTitle: row.section_title,
    score: row.combined_score,
    sourceProvider: sources.get(row.file_id)?.source_provider ?? "upload",
    sourceUrl: sources.get(row.file_id)?.source_url ?? null,
    userDescription: descriptions.get(row.document_id)?.user_description ?? "",
    agentSummary: descriptions.get(row.document_id)?.agent_summary ?? "",
  }));
  const driveResults: KnowledgeSearchResult[] = ((driveMatches.data ?? []) as DriveSearchRow[]).map((row) => ({
    chunkId: row.item_id,
    documentId: row.item_id,
    scope: "project",
    fileId: row.item_id,
    fileName: row.file_name,
    content: `云盘路径：${row.path_text}\n${row.content_summary}`,
    pageNumber: null,
    sectionTitle: row.item_type === "folder" ? "云盘文件夹" : `云盘${row.item_type}`,
    score: row.combined_score,
    sourceProvider: "feishu_drive",
    sourceUrl: row.source_url,
    userDescription: "",
    agentSummary: row.content_summary,
  }));
  return [...documentResults, ...driveResults].sort((left, right) => right.score - left.score).slice(0, limit);
}
