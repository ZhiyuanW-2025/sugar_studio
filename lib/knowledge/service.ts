import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveModelConfig } from "../model-config/service";
import { createAdminClient } from "../supabase/admin";
import { chunkKnowledgePages } from "./chunker";
import {
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  KNOWLEDGE_EMBEDDING_MODEL,
  KNOWLEDGE_EMBEDDING_PROVIDER,
  KNOWLEDGE_PARSER_VERSION,
  isIndexableKnowledgeExtension,
} from "./config";
import { createKnowledgeEmbeddings, toPostgresVector } from "./embeddings";
import { extractKnowledgeText } from "./extract-text";
import { extractTextWithVision } from "./ocr";
import { sha256Hex } from "./checksum";
import type { KnowledgeScope } from "./types";

type DocumentRow = {
  id: string;
  scope: KnowledgeScope;
  project_id: string | null;
  project_file_id: string | null;
  company_file_id: string | null;
  status: string;
};

type SourceFile = {
  id: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  storageBucket: "project-files" | "company-knowledge";
  storagePath: string;
};

type JobRow = { id: string; status: string; attempt_count: number; max_attempts: number };

export class KnowledgeIndexError extends Error {
  constructor(
    message: string,
    public readonly code: "forbidden" | "not_found" | "unsupported" | "busy" | "model_missing" | "failed",
  ) {
    super(message);
  }
}

function safeFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNSUPPORTED_KNOWLEDGE_FILE") return "该文件格式暂不支持建立知识索引。";
  if (message === "DOCX_MAIN_DOCUMENT_MISSING") return "Word 文件内容无法读取，请检查文件是否损坏。";
  if (message === "INVALID_EMBEDDING_RESPONSE") return "模型服务返回了无效的知识向量。";
  if (/vision|image|input_file|unsupported.*model/i.test(message)) return "当前模型无法完成图片或扫描件识别，请在模型设置中选择支持视觉输入的模型。";
  if (/password|encrypted|corrupt|invalid.*pdf/i.test(message)) return "文件无法解析，请检查文件是否损坏或受密码保护。";
  return "知识解析失败，请稍后重试。";
}

async function requireAccess(supabase: SupabaseClient, userId: string, document: DocumentRow) {
  if (document.scope === "project") {
    const { data, error } = await supabase
      .from("project_members")
      .select("id")
      .eq("project_id", document.project_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) throw new KnowledgeIndexError("你没有权限处理该项目知识。", "forbidden");
    return;
  }

  const { data, error } = await supabase
    .from("project_members")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (error || !data?.length) throw new KnowledgeIndexError("你没有权限处理公司知识。", "forbidden");
}

async function loadSource(supabase: SupabaseClient, document: DocumentRow): Promise<SourceFile> {
  if (document.scope === "project" && document.project_file_id) {
    const { data, error } = await supabase
      .from("project_files")
      .select("id, file_name, file_type, mime_type, storage_path")
      .eq("id", document.project_file_id)
      .maybeSingle();
    if (error || !data) throw new KnowledgeIndexError("没有找到项目源文件。", "not_found");
    return {
      id: data.id,
      fileName: data.file_name,
      fileType: data.file_type,
      mimeType: data.mime_type,
      storageBucket: "project-files",
      storagePath: data.storage_path,
    };
  }

  if (document.scope === "company" && document.company_file_id) {
    const { data, error } = await supabase
      .from("company_files")
      .select("id, file_name, file_type, mime_type, storage_path")
      .eq("id", document.company_file_id)
      .maybeSingle();
    if (error || !data) throw new KnowledgeIndexError("没有找到公司源文件。", "not_found");
    return {
      id: data.id,
      fileName: data.file_name,
      fileType: data.file_type,
      mimeType: data.mime_type,
      storageBucket: "company-knowledge",
      storagePath: data.storage_path,
    };
  }

  throw new KnowledgeIndexError("知识文档没有有效的源文件。", "not_found");
}

async function findOrCreateJob(documentId: string, userId: string): Promise<JobRow> {
  const admin = createAdminClient();
  const { data: active, error } = await admin
    .from("knowledge_ingestion_jobs")
    .select("id, status, attempt_count, max_attempts")
    .eq("document_id", documentId)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new KnowledgeIndexError("暂时无法读取知识处理任务。", "failed");
  if (active?.status === "processing") throw new KnowledgeIndexError("该文件正在建立知识索引。", "busy");
  if (active) return active as JobRow;

  const { data, error: insertError } = await admin
    .from("knowledge_ingestion_jobs")
    .insert({ document_id: documentId, requested_by: userId })
    .select("id, status, attempt_count, max_attempts")
    .single();
  if (insertError || !data) throw new KnowledgeIndexError("暂时无法创建知识处理任务。", "failed");
  return data as JobRow;
}

export async function indexKnowledgeDocument(input: {
  supabase: SupabaseClient;
  userId: string;
  documentId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("knowledge_documents")
    .select("id, scope, project_id, project_file_id, company_file_id, status")
    .eq("id", input.documentId)
    .maybeSingle();
  if (error || !data) throw new KnowledgeIndexError("没有找到知识文档。", "not_found");
  const document = data as DocumentRow;
  await requireAccess(input.supabase, input.userId, document);
  const source = await loadSource(input.supabase, document);
  if (!isIndexableKnowledgeExtension(source.fileType)) {
    throw new KnowledgeIndexError("该文件格式暂不支持建立知识索引。", "unsupported");
  }

  let resolved;
  try {
    resolved = await resolveModelConfig(input.userId, "planning");
  } catch (modelError) {
    if (modelError instanceof Error && modelError.message === "No model configuration is available for this user.") {
      throw new KnowledgeIndexError("请先在设置中配置 OpenAI 模型，再建立知识索引。", "model_missing");
    }
    throw new KnowledgeIndexError("暂时无法读取模型配置。", "failed");
  }
  if (resolved.provider !== "openai") {
    throw new KnowledgeIndexError("当前知识索引暂时只支持 OpenAI。", "model_missing");
  }

  const job = await findOrCreateJob(document.id, input.userId);
  const startedAt = new Date().toISOString();
  const { data: claimedJob, error: claimError } = await admin
    .from("knowledge_ingestion_jobs")
    .update({
      status: "processing",
      attempt_count: job.attempt_count + 1,
      started_at: startedAt,
      completed_at: null,
      error_message: null,
      progress: 5,
      progress_message: "正在读取源文件",
    })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimError || !claimedJob) {
    throw new KnowledgeIndexError("该文件正在建立知识索引。", "busy");
  }
  const { error: processingError } = await admin
    .from("knowledge_documents")
    .update({ status: "processing", error_message: null })
    .eq("id", document.id);
  if (processingError) {
    await admin.from("knowledge_ingestion_jobs").update({ status: "failed", error_message: "Unable to start indexing." }).eq("id", job.id);
    throw new KnowledgeIndexError("暂时无法启动知识解析。", "failed");
  }

  try {
    const { data: blob, error: downloadError } = await input.supabase.storage
      .from(source.storageBucket)
      .download(source.storagePath);
    if (downloadError || !blob) throw new Error("SOURCE_DOWNLOAD_FAILED");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const checksum = await sha256Hex(bytes);
    await admin.from("knowledge_ingestion_jobs").update({ progress: 20, progress_message: "正在提取文字" }).eq("id", job.id);
    let pages = await extractKnowledgeText({ bytes, extension: source.fileType }).catch(() => []);
    const extractedCharacters = pages.reduce((total, page) => total + page.text.length, 0);
    const needsVision = source.mimeType.startsWith("image/") || (source.fileType === "pdf" && extractedCharacters === 0);
    if (needsVision) {
      pages = await extractTextWithVision({
        apiKey: resolved.apiKey,
        model: resolved.model,
        bytes,
        fileName: source.fileName,
        mimeType: source.mimeType,
      });
    }
    const chunks = chunkKnowledgePages(pages);
    if (chunks.length === 0) throw new Error("NO_EXTRACTABLE_TEXT");
    await admin.from("knowledge_ingestion_jobs").update({ progress: 50, progress_message: "正在生成知识向量" }).eq("id", job.id);
    const embeddings = await createKnowledgeEmbeddings({
      apiKey: resolved.apiKey,
      texts: chunks.map((chunk) => chunk.content),
    });

    const { error: deleteError } = await admin
      .from("knowledge_chunks")
      .delete()
      .eq("document_id", document.id);
    if (deleteError) throw new Error("OLD_CHUNK_DELETE_FAILED");
    await admin.from("knowledge_ingestion_jobs").update({ progress: 75, progress_message: "正在写入知识索引" }).eq("id", job.id);

    for (let offset = 0; offset < chunks.length; offset += 100) {
      const batch = chunks.slice(offset, offset + 100).map((chunk, index) => ({
        document_id: document.id,
        scope: document.scope,
        project_id: document.project_id,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        page_number: chunk.pageNumber,
        section_title: chunk.sectionTitle,
        token_count: chunk.tokenCount,
        metadata: { sourceFileType: source.fileType, sourceMimeType: source.mimeType },
        embedding: toPostgresVector(embeddings[offset + index]),
      }));
      const { error: chunkError } = await admin.from("knowledge_chunks").insert(batch);
      if (chunkError) throw new Error("CHUNK_INSERT_FAILED");
    }

    const completedAt = new Date().toISOString();
    const [{ error: documentError }, { error: jobError }] = await Promise.all([
      admin.from("knowledge_documents").update({
        status: "ready",
        checksum,
        parser_version: KNOWLEDGE_PARSER_VERSION,
        embedding_provider: KNOWLEDGE_EMBEDDING_PROVIDER,
        embedding_model: KNOWLEDGE_EMBEDDING_MODEL,
        embedding_dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
        page_count: pages.length,
        chunk_count: chunks.length,
        error_message: null,
        indexed_at: completedAt,
      }).eq("id", document.id),
      admin.from("knowledge_ingestion_jobs").update({
        status: "completed",
        completed_at: completedAt,
        error_message: null,
        progress: 100,
        progress_message: "索引已完成",
      }).eq("id", job.id),
    ]);
    if (documentError || jobError) throw new Error("INDEX_FINALIZE_FAILED");

    return {
      documentId: document.id,
      fileId: source.id,
      fileName: source.fileName,
      status: "ready" as const,
      pageCount: pages.length,
      chunkCount: chunks.length,
    };
  } catch (indexError) {
    const safeMessage = safeFailureMessage(indexError);
    const completedAt = new Date().toISOString();
    const nextAttemptCount = job.attempt_count + 1;
    const willRetry = nextAttemptCount < job.max_attempts;
    const retryAt = new Date(Date.now() + Math.min(60_000 * 2 ** Math.max(nextAttemptCount - 1, 0), 15 * 60_000)).toISOString();
    await Promise.all([
      admin.from("knowledge_documents").update({ status: willRetry ? "pending" : "failed", error_message: safeMessage }).eq("id", document.id),
      admin.from("knowledge_ingestion_jobs").update({
        status: willRetry ? "pending" : "failed",
        completed_at: willRetry ? null : completedAt,
        next_attempt_at: retryAt,
        progress: 0,
        progress_message: willRetry ? "等待自动重试" : "索引失败",
        error_message: safeMessage,
      }).eq("id", job.id),
    ]);
    throw new KnowledgeIndexError(willRetry ? `${safeMessage} 系统稍后会自动重试。` : safeMessage, "failed");
  }
}
