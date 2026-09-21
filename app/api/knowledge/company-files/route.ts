import { WorkspaceAccessError, requireWorkspaceMember } from "../../../../lib/knowledge/access";
import {
  getAllowedProjectFile,
  MAX_PROJECT_FILE_SIZE,
  sanitizeProjectFileName,
} from "../../../../lib/projects/file-types";
import { isUuid } from "../../../../lib/model-config/http";
import { sha256Hex } from "../../../../lib/knowledge/checksum";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers });

function accessErrorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) return errorResponse(error.message, error.status);
  return errorResponse("暂时无法访问公司知识，请稍后重试。", 500);
}

type CompanyFileRow = {
  id: string;
  file_name: string;
  file_type: string;
  mime_type: string;
  size: number;
  uploaded_by: string | null;
  created_at: string;
  checksum: string | null;
  version: number;
  replaces_file_id: string | null;
  superseded_at: string | null;
  source_provider: "upload" | "feishu";
  source_url: string | null;
};

type KnowledgeRow = {
  id: string;
  company_file_id: string;
  status: string;
  page_count: number | null;
  chunk_count: number;
  error_message: string | null;
  indexed_at: string | null;
  user_description: string;
  agent_summary: string;
};

type KnowledgeJobRow = {
  document_id: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  progress: number;
  progress_message: string | null;
  created_at: string;
};

export async function GET() {
  try {
    const { supabase } = await requireWorkspaceMember();
    const { data, error } = await supabase
      .from("company_files")
      .select("id, file_name, file_type, mime_type, size, uploaded_by, created_at, checksum, version, replaces_file_id, superseded_at, source_provider, source_url")
      .order("created_at", { ascending: false });
    if (error) return errorResponse("暂时无法加载公司知识文件。", 500);
    const rows = (data ?? []) as CompanyFileRow[];
    const fileIds = rows.map((row) => row.id);
    const knowledgeByFile = new Map<string, KnowledgeRow>();
    const jobsByDocument = new Map<string, KnowledgeJobRow>();
    if (fileIds.length > 0) {
      const { data: documents } = await supabase
        .from("knowledge_documents")
        .select("id, company_file_id, status, page_count, chunk_count, error_message, indexed_at, user_description, agent_summary")
        .in("company_file_id", fileIds);
      for (const document of (documents ?? []) as KnowledgeRow[]) {
        knowledgeByFile.set(document.company_file_id, document);
      }
      const documentIds = [...knowledgeByFile.values()].map((document) => document.id);
      if (documentIds.length) {
        const { data: jobs } = await supabase.from("knowledge_ingestion_jobs")
          .select("document_id, status, attempt_count, max_attempts, next_attempt_at, progress, progress_message, created_at")
          .in("document_id", documentIds).order("created_at", { ascending: false });
        for (const job of (jobs ?? []) as KnowledgeJobRow[]) {
          if (!jobsByDocument.has(job.document_id)) jobsByDocument.set(job.document_id, job);
        }
      }
    }

    const uploaderIds = [...new Set(rows.map((row) => row.uploaded_by).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (uploaderIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("id", uploaderIds);
      for (const profile of profiles ?? []) names.set(profile.id, profile.display_name || "工作室成员");
    }

    return Response.json({
      files: rows.map((row) => {
        const knowledge = knowledgeByFile.get(row.id);
        return {
          id: row.id,
          fileName: row.file_name,
          fileType: row.file_type,
          mimeType: row.mime_type,
          size: row.size,
          uploaderName: row.uploaded_by ? names.get(row.uploaded_by) ?? "工作室成员" : "已离开成员",
          createdAt: row.created_at,
          checksum: row.checksum,
          version: row.version,
          replacesFileId: row.replaces_file_id,
          supersededAt: row.superseded_at,
          sourceProvider: row.source_provider,
          sourceUrl: row.source_url,
          knowledge: knowledge ? {
            documentId: knowledge.id,
            status: knowledge.status,
            pageCount: knowledge.page_count,
            chunkCount: knowledge.chunk_count,
            error: knowledge.error_message,
            indexedAt: knowledge.indexed_at,
            userDescription: knowledge.user_description,
            agentSummary: knowledge.agent_summary,
            job: jobsByDocument.has(knowledge.id) ? {
              status: jobsByDocument.get(knowledge.id)!.status,
              attemptCount: jobsByDocument.get(knowledge.id)!.attempt_count,
              maxAttempts: jobsByDocument.get(knowledge.id)!.max_attempts,
              nextAttemptAt: jobsByDocument.get(knowledge.id)!.next_attempt_at,
              progress: jobsByDocument.get(knowledge.id)!.progress,
              progressMessage: jobsByDocument.get(knowledge.id)!.progress_message,
            } : null,
          } : null,
        };
      }),
    }, { headers });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const replacesFileIdValue = form?.get("replacesFileId");
  const displayNameValue = form?.get("displayName");
  const userDescriptionValue = form?.get("userDescription");
  const userDescription = typeof userDescriptionValue === "string" ? userDescriptionValue.trim().slice(0, 8_000) : "";
  const replacesFileId = typeof replacesFileIdValue === "string" && isUuid(replacesFileIdValue) ? replacesFileIdValue : null;
  if (!(file instanceof File)) return errorResponse("请选择要上传的文件。", 400);
  if (file.size <= 0 || file.size > MAX_PROJECT_FILE_SIZE) {
    return errorResponse("文件大小必须在 25 MB 以内。", 400);
  }
  const fileName = sanitizeProjectFileName(typeof displayNameValue === "string" && displayNameValue.trim() ? displayNameValue.trim() : file.name);
  const allowed = getAllowedProjectFile(fileName);
  if (!fileName || !allowed) return errorResponse("暂不支持该文件格式。", 415);

  try {
    const { supabase } = await requireWorkspaceMember();
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const checksum = await sha256Hex(fileBytes);
    const { data: duplicate } = await supabase.from("company_files").select("id, file_name")
      .eq("checksum", checksum).is("superseded_at", null).limit(1).maybeSingle();
    if (duplicate) return errorResponse(`该文件内容与「${duplicate.file_name}」完全相同，无需重复上传。`, 409);
    const fileId = crypto.randomUUID();
    const storagePath = `${fileId}/source.${allowed.extension}`;
    const { error: uploadError } = await supabase.storage.from("company-knowledge").upload(storagePath, fileBytes, {
      contentType: allowed.mimeType,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) return errorResponse("文件上传失败，请稍后重试。", 500);

    const { data, error: metadataError } = await supabase.rpc("register_company_file_v2", {
      p_id: fileId,
      p_file_name: fileName,
      p_storage_path: storagePath,
      p_file_type: allowed.extension,
      p_mime_type: allowed.mimeType,
      p_size: file.size,
      p_checksum: checksum,
      p_replaces_file_id: replacesFileId,
    });
    if (metadataError || !data) {
      await supabase.storage.from("company-knowledge").remove([storagePath]);
      return errorResponse(metadataError?.message.includes("Duplicate") ? "相同内容的文件已经存在。" : "文件信息保存失败，上传已撤销。", metadataError?.message.includes("Duplicate") ? 409 : 500);
    }
    const { data: document } = await supabase
      .from("knowledge_documents")
      .select("id, status")
      .eq("company_file_id", fileId)
      .maybeSingle();
    if (document && userDescription) {
      const { error: descriptionError } = await supabase.rpc("update_knowledge_document_descriptions", {
        p_document_id: document.id,
        p_user_description: userDescription,
        p_agent_summary: null,
      });
      if (descriptionError) return errorResponse("文件已保存，但材料说明暂时无法绑定，请稍后重试。", 500);
    }
    return Response.json({
      uploaded: true,
      file: data,
      knowledge: document ? { documentId: document.id, status: document.status } : null,
    }, { status: 201, headers });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
