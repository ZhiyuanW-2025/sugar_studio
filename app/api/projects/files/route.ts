import { isUuid } from "../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";
import {
  getAllowedProjectFile,
  MAX_PROJECT_FILE_SIZE,
  sanitizeProjectFileName,
} from "../../../../lib/projects/file-types";
import { sha256Hex } from "../../../../lib/knowledge/checksum";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };

type FileRow = {
  id: string;
  project_id: string;
  file_name: string;
  storage_path: string;
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

type KnowledgeDocumentRow = {
  id: string;
  project_file_id: string;
  status: "pending" | "processing" | "ready" | "failed" | "unsupported";
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

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers: responseHeaders });
}

function accessErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
  return errorResponse("暂时无法访问项目文件，请稍后重试。", 500);
}

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return errorResponse("项目参数无效。", 400);

  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data, error } = await supabase
      .from("project_files")
      .select("id, project_id, file_name, storage_path, file_type, mime_type, size, uploaded_by, created_at, checksum, version, replaces_file_id, superseded_at, source_provider, source_url")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) return errorResponse("暂时无法加载项目文件。", 500);

    const rows = (data ?? []) as FileRow[];
    const fileIds = rows.map((row) => row.id);
    const knowledgeByFile = new Map<string, KnowledgeDocumentRow>();
    const jobsByDocument = new Map<string, KnowledgeJobRow>();
    if (fileIds.length > 0) {
      const { data: knowledgeDocuments } = await supabase
        .from("knowledge_documents")
        .select("id, project_file_id, status, page_count, chunk_count, error_message, indexed_at, user_description, agent_summary")
        .in("project_file_id", fileIds);
      for (const document of (knowledgeDocuments ?? []) as KnowledgeDocumentRow[]) {
        knowledgeByFile.set(document.project_file_id, document);
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
    const uploaderNames = new Map<string, string>();
    if (uploaderIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", uploaderIds);
      for (const profile of profiles ?? []) {
        uploaderNames.set(profile.id, profile.display_name || "项目成员");
      }
    }

    return Response.json(
      {
        files: rows.map((row) => ({
          id: row.id,
          fileName: row.file_name,
          fileType: row.file_type,
          mimeType: row.mime_type,
          size: row.size,
          uploadedBy: row.uploaded_by,
          uploaderName: row.uploaded_by
            ? uploaderNames.get(row.uploaded_by) ?? "项目成员"
            : "已离开成员",
          createdAt: row.created_at,
          checksum: row.checksum,
          version: row.version,
          replacesFileId: row.replaces_file_id,
          supersededAt: row.superseded_at,
          sourceProvider: row.source_provider,
          sourceUrl: row.source_url,
          knowledge: knowledgeByFile.has(row.id)
            ? {
                documentId: knowledgeByFile.get(row.id)!.id,
                status: knowledgeByFile.get(row.id)!.status,
                pageCount: knowledgeByFile.get(row.id)!.page_count,
                chunkCount: knowledgeByFile.get(row.id)!.chunk_count,
                error: knowledgeByFile.get(row.id)!.error_message,
                indexedAt: knowledgeByFile.get(row.id)!.indexed_at,
                userDescription: knowledgeByFile.get(row.id)!.user_description,
                agentSummary: knowledgeByFile.get(row.id)!.agent_summary,
                job: jobsByDocument.has(knowledgeByFile.get(row.id)!.id) ? {
                  status: jobsByDocument.get(knowledgeByFile.get(row.id)!.id)!.status,
                  attemptCount: jobsByDocument.get(knowledgeByFile.get(row.id)!.id)!.attempt_count,
                  maxAttempts: jobsByDocument.get(knowledgeByFile.get(row.id)!.id)!.max_attempts,
                  nextAttemptAt: jobsByDocument.get(knowledgeByFile.get(row.id)!.id)!.next_attempt_at,
                  progress: jobsByDocument.get(knowledgeByFile.get(row.id)!.id)!.progress,
                  progressMessage: jobsByDocument.get(knowledgeByFile.get(row.id)!.id)!.progress_message,
                } : null,
              }
            : null,
        })),
      },
      { headers: responseHeaders },
    );
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const projectId = form?.get("projectId");
  const file = form?.get("file");
  const replacesFileIdValue = form?.get("replacesFileId");
  const displayNameValue = form?.get("displayName");
  const userDescriptionValue = form?.get("userDescription");
  const userDescription = typeof userDescriptionValue === "string" ? userDescriptionValue.trim().slice(0, 8_000) : "";
  const replacesFileId = typeof replacesFileIdValue === "string" && isUuid(replacesFileIdValue) ? replacesFileIdValue : null;

  if (!isUuid(projectId) || !(file instanceof File)) {
    return errorResponse("请选择要上传的文件。", 400);
  }
  if (file.size <= 0 || file.size > MAX_PROJECT_FILE_SIZE) {
    return errorResponse("文件大小必须在 25 MB 以内。", 400);
  }

  const fileName = sanitizeProjectFileName(typeof displayNameValue === "string" && displayNameValue.trim() ? displayNameValue.trim() : file.name);
  const allowed = getAllowedProjectFile(fileName);
  if (!fileName || !allowed) {
    return errorResponse("暂不支持该文件格式。", 415);
  }

  try {
    const { supabase } = await requireProjectMember(projectId);
    // Workerd File objects are not always recognized as native upload bodies by
    // storage-js. Sending bytes keeps the explicit MIME type intact.
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const checksum = await sha256Hex(fileBytes);
    const { data: duplicate } = await supabase.from("project_files").select("id, file_name")
      .eq("project_id", projectId).eq("checksum", checksum).is("superseded_at", null).limit(1).maybeSingle();
    if (duplicate) return errorResponse(`该文件内容与「${duplicate.file_name}」完全相同，无需重复上传。`, 409);
    const fileId = crypto.randomUUID();
    const storagePath = `${projectId}/${fileId}/source.${allowed.extension}`;
    const { error: uploadError } = await supabase.storage
      .from("project-files")
      .upload(storagePath, fileBytes, {
        contentType: allowed.mimeType,
        cacheControl: "3600",
        upsert: false,
      });
    if (uploadError) return errorResponse("文件上传失败，请稍后重试。", 500);

    const { data, error: metadataError } = await supabase.rpc("register_project_file_v2", {
      p_id: fileId,
      p_project_id: projectId,
      p_file_name: fileName,
      p_storage_path: storagePath,
      p_file_type: allowed.extension,
      p_mime_type: allowed.mimeType,
      p_size: file.size,
      p_checksum: checksum,
      p_replaces_file_id: replacesFileId,
    });

    if (metadataError || !data) {
      await supabase.storage.from("project-files").remove([storagePath]);
      return errorResponse(metadataError?.message.includes("Duplicate") ? "相同内容的文件已经存在。" : "文件信息保存失败，上传已撤销。", metadataError?.message.includes("Duplicate") ? 409 : 500);
    }

    const { data: document } = await supabase
      .from("knowledge_documents")
      .select("id, status")
      .eq("project_file_id", fileId)
      .maybeSingle();

    if (document && userDescription) {
      const { error: descriptionError } = await supabase.rpc("update_knowledge_document_descriptions", {
        p_document_id: document.id,
        p_user_description: userDescription,
        p_agent_summary: null,
      });
      if (descriptionError) return errorResponse("文件已保存，但材料说明暂时无法绑定，请稍后重试。", 500);
    }

    return Response.json(
      {
        uploaded: true,
        file: data,
        knowledge: document ? { documentId: document.id, status: document.status } : null,
      },
      { status: 201, headers: responseHeaders },
    );
  } catch (error) {
    return accessErrorResponse(error);
  }
}
