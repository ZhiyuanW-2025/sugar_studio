import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelAgentType } from "../model-config/catalog";
import { createAdminClient } from "../supabase/admin";
import { KNOWLEDGE_DEFAULT_MATCH_COUNT, KNOWLEDGE_MAX_MATCH_COUNT } from "./config";
import { createKnowledgeEmbeddings, toPostgresVector } from "./embeddings";

type MatchRow = {
  chunk_id: string;
  document_id: string;
  file_id: string;
  file_name: string;
  content: string;
  page_number: number | null;
  section_title: string | null;
  combined_score: number;
};

export type AgentGeneralKnowledgeResult = {
  chunkId: string;
  documentId: string;
  fileName: string;
  content: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  score: number;
  sourceUrl: string | null;
  userDescription: string;
  agentSummary: string;
};

export async function searchAgentGeneralKnowledge(input: {
  supabase: SupabaseClient;
  agentType: ModelAgentType;
  apiKey: string;
  query: string;
  limit?: number;
}) {
  const query = input.query.trim().slice(0, 1_000);
  if (!query) return [] as AgentGeneralKnowledgeResult[];

  const { data: agent, error: agentError } = await input.supabase.from("agents")
    .select("general_feishu_scope_id")
    .eq("agent_type", input.agentType)
    .maybeSingle();
  if (agentError) throw new Error("Agent general knowledge access denied.");
  if (!agent?.general_feishu_scope_id) return [] as AgentGeneralKnowledgeResult[];

  const [embedding] = await createKnowledgeEmbeddings({ apiKey: input.apiKey, texts: [query] });
  const limit = Math.min(Math.max(input.limit ?? KNOWLEDGE_DEFAULT_MATCH_COUNT, 1), KNOWLEDGE_MAX_MATCH_COUNT);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("match_agent_general_knowledge_chunks", {
    p_agent_type: input.agentType,
    p_query_text: query,
    p_query_embedding: toPostgresVector(embedding),
    p_match_count: limit,
  });
  if (error) throw new Error("Agent general knowledge search failed.");
  const rows = (data ?? []) as MatchRow[];
  const documentIds = [...new Set(rows.map((row) => row.document_id))];
  const fileIds = [...new Set(rows.map((row) => row.file_id))];
  const [files, documents] = await Promise.all([
    fileIds.length ? admin.from("company_files").select("id,source_url").in("id", fileIds) : Promise.resolve({ data: [], error: null }),
    documentIds.length ? admin.from("knowledge_documents").select("id,user_description,agent_summary").in("id", documentIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (files.error || documents.error) throw new Error("Agent general knowledge source lookup failed.");
  const urls = new Map((files.data ?? []).map((item) => [item.id, item.source_url]));
  const descriptions = new Map((documents.data ?? []).map((item) => [item.id, item]));
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    fileName: row.file_name,
    content: row.content,
    pageNumber: row.page_number,
    sectionTitle: row.section_title,
    score: row.combined_score,
    sourceUrl: urls.get(row.file_id) ?? null,
    userDescription: descriptions.get(row.document_id)?.user_description ?? "",
    agentSummary: descriptions.get(row.document_id)?.agent_summary ?? "",
  }));
}
