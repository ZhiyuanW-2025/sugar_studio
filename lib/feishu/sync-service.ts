import "server-only";

import { createAdminClient } from "../supabase/admin";
import { sha256Hex } from "../knowledge/checksum";
import {
  downloadFeishuDriveFile,
  FeishuApiError,
  getFeishuKnowledgeSnapshot,
  getFeishuWikiNode,
  listFeishuWikiNodes,
  subscribeFeishuDocumentEvents,
  type FeishuDocumentSnapshot,
  type FeishuWikiNode,
} from "./client";
import { FEISHU_KNOWLEDGE_FILE_MAX_BYTES, getFeishuConfigurationStatus } from "./config";
import { chooseFeishuSyncScope, getFeishuSyncScope, nextWeeklySync, type FeishuSyncScope } from "./scope-service";
import { isIndexableKnowledgeExtension } from "../knowledge/config";

type MappingRow = {
  id: string;
  sync_scope_id: string;
  node_token: string;
  obj_token: string;
  obj_type: string;
  external_updated_at: string | null;
  content_checksum: string | null;
  company_file_id: string | null;
  project_file_id: string | null;
  sync_status: string;
};

async function queueReindex(input: { fileId: string; scopeType: "company" | "project"; requestedBy: string }) {
  const admin = createAdminClient();
  const column = input.scopeType === "company" ? "company_file_id" : "project_file_id";
  const { data: document, error } = await admin.from("knowledge_documents")
    .select("id").eq(column, input.fileId).maybeSingle();
  if (error || !document) throw new Error("FEISHU_KNOWLEDGE_DOCUMENT_MISSING");
  await admin.from("knowledge_ingestion_jobs").update({
    status: "failed",
    error_message: "Replaced by a newer Feishu revision.",
    completed_at: new Date().toISOString(),
    progress: 0,
    progress_message: "已由更新版本替代",
  }).eq("document_id", document.id).in("status", ["pending", "processing"]);
  const { error: documentError } = await admin.from("knowledge_documents")
    .update({ status: "pending", error_message: null, indexed_at: null }).eq("id", document.id);
  if (documentError) throw new Error("FEISHU_KNOWLEDGE_RESET_FAILED");
  const { error: jobError } = await admin.from("knowledge_ingestion_jobs")
    .insert({ document_id: document.id, requested_by: input.requestedBy });
  if (jobError) throw new Error("FEISHU_KNOWLEDGE_JOB_FAILED");
  return document.id as string;
}

async function findMapping(scopeId: string, nodeToken: string) {
  const { data, error } = await createAdminClient().from("feishu_knowledge_documents")
    .select("id, sync_scope_id, node_token, obj_token, obj_type, external_updated_at, content_checksum, company_file_id, project_file_id, sync_status")
    .eq("sync_scope_id", scopeId).eq("node_token", nodeToken).maybeSingle();
  if (error) throw new Error("FEISHU_MAPPING_LOOKUP_FAILED");
  return data as MappingRow | null;
}

async function saveMapping(existingId: string | null, values: Record<string, unknown>) {
  const admin = createAdminClient();
  const query = existingId
    ? admin.from("feishu_knowledge_documents").update(values).eq("id", existingId)
    : admin.from("feishu_knowledge_documents").insert(values);
  const { data, error } = await query.select("id").single();
  if (error || !data) throw new Error("FEISHU_MAPPING_SAVE_FAILED");
  return data.id as string;
}

async function saveRevision(documentId: string, snapshot: FeishuDocumentSnapshot, checksum: string, source: "sync" | "pre_write" | "post_write") {
  const { data, error } = await createAdminClient().from("feishu_document_revisions").upsert({
    document_id: documentId,
    external_revision: snapshot.revision,
    content_checksum: checksum,
    raw_content: snapshot.content,
    blocks: snapshot.blocks,
    source,
  }, { onConflict: "document_id,external_revision,content_checksum", ignoreDuplicates: false }).select("id").single();
  if (error || !data) throw new Error("FEISHU_REVISION_SAVE_FAILED");
  return data.id as string;
}

export async function captureFeishuRevision(documentId: string, snapshot: FeishuDocumentSnapshot, source: "sync" | "pre_write" | "post_write") {
  const checksum = await sha256Hex(new TextEncoder().encode(snapshot.content));
  return saveRevision(documentId, snapshot, checksum, source);
}

async function saveTextMirror(input: {
  scope: FeishuSyncScope;
  existing: MappingRow | null;
  node: FeishuWikiNode;
  snapshot: FeishuDocumentSnapshot;
  bytes: Uint8Array;
  requestedBy: string;
}) {
  const admin = createAdminClient();
  const currentFileId = input.scope.scopeType === "company" ? input.existing?.company_file_id : input.existing?.project_file_id;
  const fileId = currentFileId ?? crypto.randomUUID();
  const fileName = input.snapshot.title.trim();
  const bucket = input.scope.scopeType === "company" ? "company-knowledge" : "project-files";
  const storagePath = input.scope.scopeType === "company"
    ? `${fileId}/source.txt`
    : `${input.scope.projectId}/${fileId}/source.txt`;
  const { error: uploadError } = await admin.storage.from(bucket).upload(storagePath, input.bytes, {
    contentType: "text/plain", cacheControl: "60", upsert: true,
  });
  if (uploadError) {
    console.error("[feishu] mirror storage upload failed", {
      message: uploadError.message,
      status: "statusCode" in uploadError ? uploadError.statusCode : undefined,
      bucket,
    });
    throw new Error("FEISHU_MIRROR_UPLOAD_FAILED");
  }

  const values = {
    file_name: fileName,
    storage_path: storagePath,
    file_type: "txt",
    mime_type: "text/plain",
    size: input.bytes.byteLength,
    uploaded_by: input.requestedBy,
    source_provider: "feishu",
    source_external_id: input.node.nodeToken,
    source_url: input.node.url,
    source_updated_at: input.node.editedAt,
  };
  const table = input.scope.scopeType === "company" ? "company_files" : "project_files";
  const mutation = currentFileId
    ? admin.from(table).update(values).eq("id", fileId)
    : admin.from(table).insert(input.scope.scopeType === "project" ? { ...values, id: fileId, project_id: input.scope.projectId } : { ...values, id: fileId });
  const { error: fileError } = await mutation;
  if (fileError) {
    if (!currentFileId) await admin.storage.from(bucket).remove([storagePath]);
    throw new Error("FEISHU_MIRROR_METADATA_FAILED");
  }
  return { fileId, created: !currentFileId };
}

function extensionFromName(fileName: string) {
  const match = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function fallbackMimeType(extension: string) {
  const types: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
    md: "text/markdown",
    markdown: "text/markdown",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  return types[extension] ?? "application/octet-stream";
}

async function saveBinaryMirror(input: {
  scope: FeishuSyncScope;
  existing: MappingRow | null;
  node: FeishuWikiNode;
  bytes: Uint8Array;
  contentType: string | null;
  requestedBy: string;
}) {
  const admin = createAdminClient();
  const extension = extensionFromName(input.node.title);
  const currentFileId = input.scope.scopeType === "company" ? input.existing?.company_file_id : input.existing?.project_file_id;
  const fileId = currentFileId ?? crypto.randomUUID();
  const bucket = input.scope.scopeType === "company" ? "company-knowledge" : "project-files";
  const storagePath = input.scope.scopeType === "company"
    ? `${fileId}/source.${extension}`
    : `${input.scope.projectId}/${fileId}/source.${extension}`;
  const mimeType = input.contentType?.split(";")[0]?.trim() || fallbackMimeType(extension);
  const { error: uploadError } = await admin.storage.from(bucket).upload(storagePath, input.bytes, {
    contentType: mimeType,
    cacheControl: "60",
    upsert: true,
  });
  if (uploadError) throw new Error("FEISHU_FILE_MIRROR_UPLOAD_FAILED");

  const values = {
    file_name: input.node.title.trim(),
    storage_path: storagePath,
    file_type: extension,
    mime_type: mimeType,
    size: input.bytes.byteLength,
    uploaded_by: input.requestedBy,
    source_provider: "feishu",
    source_external_id: input.node.nodeToken,
    source_url: input.node.url,
    source_updated_at: input.node.editedAt,
  };
  const table = input.scope.scopeType === "company" ? "company_files" : "project_files";
  const mutation = currentFileId
    ? admin.from(table).update(values).eq("id", fileId)
    : admin.from(table).insert(input.scope.scopeType === "project" ? { ...values, id: fileId, project_id: input.scope.projectId } : { ...values, id: fileId });
  const { error: fileError } = await mutation;
  if (fileError) {
    if (!currentFileId) await admin.storage.from(bucket).remove([storagePath]);
    throw new Error("FEISHU_FILE_MIRROR_METADATA_FAILED");
  }
  return { fileId, created: !currentFileId };
}

export type FeishuSyncResult = {
  nodeToken: string;
  title: string;
  status: "unchanged" | "synced" | "unsupported" | "failed";
  documentId: string | null;
  error?: string;
};

export async function syncFeishuNode(input: {
  scope: FeishuSyncScope;
  node: FeishuWikiNode;
  requestedBy: string;
  force?: boolean;
  revisionSource?: "sync" | "pre_write" | "post_write";
}): Promise<FeishuSyncResult> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const existing = await findMapping(input.scope.id, input.node.nodeToken);
  const baseMapping = {
    sync_scope_id: input.scope.id,
    scope_type: input.scope.scopeType,
    project_id: input.scope.projectId,
    space_id: input.node.spaceId,
    node_token: input.node.nodeToken,
    parent_node_token: input.node.parentNodeToken,
    obj_token: input.node.objToken,
    obj_type: input.node.objType,
    title: input.node.title,
    source_url: input.node.url,
    external_updated_at: input.node.editedAt,
    last_seen_at: now,
  };

  if (input.node.objType === "file") {
    const extension = extensionFromName(input.node.title);
    if (!extension || !isIndexableKnowledgeExtension(extension)) {
      await saveMapping(existing?.id ?? null, {
        ...baseMapping,
        company_file_id: existing?.company_file_id ?? null,
        project_file_id: existing?.project_file_id ?? null,
        sync_status: "unsupported",
        sync_error: "该文件格式暂不支持建立知识索引。",
      });
      return { nodeToken: input.node.nodeToken, title: input.node.title, status: "unsupported", documentId: null };
    }

    if (!input.force && existing?.sync_status === "ready" && input.node.editedAt && existing.external_updated_at === input.node.editedAt) {
      await saveMapping(existing.id, { ...baseMapping, sync_error: null });
      return { nodeToken: input.node.nodeToken, title: input.node.title, status: "unchanged", documentId: null };
    }
    if (existing) await admin.from("feishu_knowledge_documents").update({ sync_status: "syncing", sync_error: null }).eq("id", existing.id);

    try {
      const downloaded = await downloadFeishuDriveFile(input.node.objToken, FEISHU_KNOWLEDGE_FILE_MAX_BYTES);
      const checksum = await sha256Hex(downloaded.bytes);
      if (!input.force && existing?.content_checksum === checksum && (existing.company_file_id || existing.project_file_id)) {
        await saveMapping(existing.id, {
          ...baseMapping,
          sync_status: "ready",
          sync_error: null,
          last_synced_at: now,
        });
        return { nodeToken: input.node.nodeToken, title: input.node.title, status: "unchanged", documentId: null };
      }
      const mirror = await saveBinaryMirror({
        scope: input.scope,
        existing,
        node: input.node,
        bytes: downloaded.bytes,
        contentType: downloaded.contentType,
        requestedBy: input.requestedBy,
      });
      await saveMapping(existing?.id ?? null, {
        ...baseMapping,
        content_checksum: checksum,
        company_file_id: input.scope.scopeType === "company" ? mirror.fileId : null,
        project_file_id: input.scope.scopeType === "project" ? mirror.fileId : null,
        sync_status: "ready",
        sync_error: null,
        last_synced_at: now,
      });
      const column = input.scope.scopeType === "company" ? "company_file_id" : "project_file_id";
      const documentId = mirror.created
        ? ((await admin.from("knowledge_documents").select("id").eq(column, mirror.fileId).single()).data?.id as string | undefined)
        : await queueReindex({ fileId: mirror.fileId, scopeType: input.scope.scopeType, requestedBy: input.requestedBy });
      return { nodeToken: input.node.nodeToken, title: input.node.title, status: "synced", documentId: documentId ?? null };
    } catch (error) {
      if (error instanceof FeishuApiError && error.status === 413) {
        await saveMapping(existing?.id ?? null, {
          ...baseMapping,
          company_file_id: existing?.company_file_id ?? null,
          project_file_id: existing?.project_file_id ?? null,
          sync_status: "unsupported",
          sync_error: "文件超过 100 MB，已保留目录记录，但暂不下载和解析内容。",
        });
        return { nodeToken: input.node.nodeToken, title: input.node.title, status: "unsupported", documentId: null };
      }
      console.error("[feishu] knowledge file pull failed", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : "Unknown Feishu file sync error",
      });
      const safe = "飞书文件同步失败。";
      await saveMapping(existing?.id ?? null, { ...baseMapping, sync_status: "failed", sync_error: safe });
      return { nodeToken: input.node.nodeToken, title: input.node.title, status: "failed", documentId: null, error: safe };
    }
  }

  if (!["docx", "sheet", "bitable"].includes(input.node.objType)) {
    await saveMapping(existing?.id ?? null, {
      ...baseMapping,
      company_file_id: existing?.company_file_id ?? null,
      project_file_id: existing?.project_file_id ?? null,
      sync_status: "unsupported",
      sync_error: "该飞书节点会保留来源记录；当前自动内容同步支持新版文档、电子表格和多维表格。",
    });
    return { nodeToken: input.node.nodeToken, title: input.node.title, status: "unsupported", documentId: null };
  }

  if (!input.force && existing?.sync_status === "ready" && input.node.editedAt && existing.external_updated_at === input.node.editedAt) {
    await saveMapping(existing.id, { ...baseMapping, sync_error: null });
    return { nodeToken: input.node.nodeToken, title: input.node.title, status: "unchanged", documentId: null };
  }
  if (existing) await admin.from("feishu_knowledge_documents").update({ sync_status: "syncing", sync_error: null }).eq("id", existing.id);

  try {
    const snapshot = await getFeishuKnowledgeSnapshot(input.node);
    if (getFeishuConfigurationStatus().hasVerificationToken) {
      // Event delivery is an optimization. A failed subscription must not block
      // the authoritative pull or the weekly reconciliation fallback.
      await subscribeFeishuDocumentEvents(input.node.objToken, input.node.objType as "docx" | "sheet" | "bitable").catch(() => undefined);
    }
    const content = snapshot.content.trim();
    if (!content) throw new Error("FEISHU_DOCUMENT_EMPTY");
    const bytes = new TextEncoder().encode(content);
    const checksum = await sha256Hex(bytes);
    if (!input.force && existing?.content_checksum === checksum && (existing.company_file_id || existing.project_file_id)) {
      const mappingId = await saveMapping(existing.id, {
        ...baseMapping,
        title: snapshot.title,
        external_revision: snapshot.revision,
        sync_status: "ready",
        sync_error: null,
        last_synced_at: now,
      });
      await saveRevision(mappingId, snapshot, checksum, input.revisionSource ?? "sync");
      return { nodeToken: input.node.nodeToken, title: snapshot.title, status: "unchanged", documentId: null };
    }

    const mirror = await saveTextMirror({ scope: input.scope, existing, node: input.node, snapshot, bytes, requestedBy: input.requestedBy });
    const mappingId = await saveMapping(existing?.id ?? null, {
      ...baseMapping,
      title: snapshot.title,
      external_revision: snapshot.revision,
      content_checksum: checksum,
      company_file_id: input.scope.scopeType === "company" ? mirror.fileId : null,
      project_file_id: input.scope.scopeType === "project" ? mirror.fileId : null,
      sync_status: "ready",
      sync_error: null,
      last_synced_at: now,
    });
    await saveRevision(mappingId, snapshot, checksum, input.revisionSource ?? "sync");
    const documentId = mirror.created
      ? ((await admin.from("knowledge_documents").select("id")
          .eq(input.scope.scopeType === "company" ? "company_file_id" : "project_file_id", mirror.fileId).single()).data?.id as string | undefined)
      : await queueReindex({ fileId: mirror.fileId, scopeType: input.scope.scopeType, requestedBy: input.requestedBy });
    return { nodeToken: input.node.nodeToken, title: snapshot.title, status: "synced", documentId: documentId ?? null };
  } catch (error) {
    const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
    console.error("[feishu] knowledge pull failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown Feishu sync error",
      status: typeof details.status === "number" ? details.status : undefined,
      code: typeof details.code === "string" || typeof details.code === "number" ? details.code : undefined,
    });
    const safe = error instanceof Error && error.message === "FEISHU_DOCUMENT_EMPTY"
      ? "飞书文档没有可索引的文字内容。" : "飞书文档同步失败。";
    await saveMapping(existing?.id ?? null, { ...baseMapping, sync_status: "failed", sync_error: safe });
    return { nodeToken: input.node.nodeToken, title: input.node.title, status: "failed", documentId: null, error: safe };
  }
}

export async function mirrorFeishuUploadedFile(input: {
  scope: FeishuSyncScope;
  fileToken: string;
  nodeToken: string | null;
  sourceUrl: string | null;
  fileName: string;
  fileType: string;
  mimeType: string;
  bytes: Uint8Array;
  uploadedBy: string;
}) {
  const admin = createAdminClient();
  const fileId = crypto.randomUUID();
  const bucket = input.scope.scopeType === "company" ? "company-knowledge" : "project-files";
  const storagePath = input.scope.scopeType === "company"
    ? `${fileId}/source.${input.fileType}`
    : `${input.scope.projectId}/${fileId}/source.${input.fileType}`;
  const { error: uploadError } = await admin.storage.from(bucket).upload(storagePath, input.bytes, {
    contentType: input.mimeType, cacheControl: "3600", upsert: false,
  });
  if (uploadError) throw new Error("FEISHU_UPLOAD_MIRROR_FAILED");
  const values = {
    id: fileId,
    file_name: input.fileName,
    storage_path: storagePath,
    file_type: input.fileType,
    mime_type: input.mimeType,
    size: input.bytes.byteLength,
    uploaded_by: input.uploadedBy,
    source_provider: "feishu",
    source_external_id: input.nodeToken ?? input.fileToken,
    source_url: input.sourceUrl,
  };
  const { error: fileError } = input.scope.scopeType === "project"
    ? await admin.from("project_files").insert({ ...values, project_id: input.scope.projectId })
    : await admin.from("company_files").insert(values);
  if (fileError) {
    await admin.storage.from(bucket).remove([storagePath]);
    throw new Error("FEISHU_UPLOAD_MIRROR_METADATA_FAILED");
  }
  const column = input.scope.scopeType === "company" ? "company_file_id" : "project_file_id";
  const { data: document, error: documentError } = await admin.from("knowledge_documents")
    .select("id, status").eq(column, fileId).single();
  if (documentError || !document) throw new Error("FEISHU_UPLOAD_KNOWLEDGE_DOCUMENT_FAILED");
  return { fileId, storagePath, documentId: document.id as string, status: document.status as string };
}

async function removeStaleMirrors(scope: FeishuSyncScope, startedAt: string) {
  const admin = createAdminClient();
  const { data: stale } = await admin.from("feishu_knowledge_documents")
    .select("id, company_file_id, project_file_id").eq("sync_scope_id", scope.id)
    .or(`last_seen_at.is.null,last_seen_at.lt.${startedAt}`).neq("sync_status", "removed");
  for (const row of stale ?? []) {
    if (row.company_file_id) await admin.from("company_files").delete().eq("id", row.company_file_id);
    if (row.project_file_id) await admin.from("project_files").delete().eq("id", row.project_file_id);
    await admin.from("feishu_knowledge_documents").update({
      sync_status: "removed", sync_error: null, company_file_id: null, project_file_id: null,
    }).eq("id", row.id);
  }
}

export async function syncFeishuKnowledge(input: { requestedBy: string; scopeId?: string; force?: boolean }) {
  const scope = input.scopeId ? await getFeishuSyncScope(input.scopeId) : await chooseFeishuSyncScope(null);
  const admin = createAdminClient();
  const startedAt = new Date().toISOString();
  await admin.from("feishu_sync_scopes").update({ last_sync_status: "syncing", last_sync_error: null }).eq("id", scope.id);
  try {
    const nodes = await listFeishuWikiNodes({ spaceId: scope.spaceId, rootNodeToken: scope.rootNodeToken });
    const results: FeishuSyncResult[] = [];
    for (const node of nodes) results.push(await syncFeishuNode({ scope, node, requestedBy: input.requestedBy, force: input.force }));
    await removeStaleMirrors(scope, startedAt);
    const completedAt = new Date().toISOString();
    await admin.from("feishu_sync_scopes").update({
      last_sync_status: results.some((item) => item.status === "failed") ? "failed" : "ready",
      last_sync_error: results.some((item) => item.status === "failed") ? "部分文档同步失败。" : null,
      last_full_sync_at: completedAt,
      next_full_sync_at: nextWeeklySync(scope.syncWeekday, scope.syncHourUtc, new Date(completedAt)),
    }).eq("id", scope.id);
    return {
      scopeId: scope.id,
      scopeType: scope.scopeType,
      projectId: scope.projectId,
      spaceId: scope.spaceId,
      total: nodes.length,
      synced: results.filter((item) => item.status === "synced").length,
      unchanged: results.filter((item) => item.status === "unchanged").length,
      unsupported: results.filter((item) => item.status === "unsupported").length,
      failed: results.filter((item) => item.status === "failed").length,
      documentIds: results.flatMap((item) => item.documentId ? [item.documentId] : []),
      results,
    };
  } catch (error) {
    await admin.from("feishu_sync_scopes").update({ last_sync_status: "failed", last_sync_error: "飞书知识同步失败。" }).eq("id", scope.id);
    throw error;
  }
}

export async function syncFeishuNodeByToken(input: { scopeId: string; nodeToken: string; requestedBy: string; force?: boolean; revisionSource?: "sync" | "pre_write" | "post_write" }) {
  const scope = await getFeishuSyncScope(input.scopeId);
  const node = await getFeishuWikiNode(input.nodeToken, scope.spaceId);
  const result = await syncFeishuNode({ scope, node, requestedBy: input.requestedBy, force: input.force, revisionSource: input.revisionSource });
  await createAdminClient().from("feishu_sync_scopes").update({
    last_incremental_sync_at: new Date().toISOString(),
    last_sync_status: result.status === "failed" ? "failed" : "ready",
    last_sync_error: result.error ?? null,
  }).eq("id", scope.id);
  return result;
}

export async function syncDueFeishuScopes(input: { requestedBy: string; limit?: number }) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("feishu_sync_scopes").select("id")
    .eq("enabled", true).eq("sync_frequency", "weekly").lte("next_full_sync_at", new Date().toISOString())
    .order("next_full_sync_at").limit(Math.min(Math.max(input.limit ?? 2, 1), 10));
  if (error) throw new Error("FEISHU_DUE_SCOPE_LOOKUP_FAILED");
  const results: Array<{ scopeId: string; ok: boolean }> = [];
  for (const row of data ?? []) {
    try {
      await syncFeishuKnowledge({ requestedBy: input.requestedBy, scopeId: row.id });
      results.push({ scopeId: row.id, ok: true });
    } catch {
      results.push({ scopeId: row.id, ok: false });
    }
  }
  return results;
}

export async function findFeishuKnowledgeWorkerUserId() {
  const admin = createAdminClient();
  // Knowledge syncing is infrastructure work and must not depend on whether a
  // member has configured an AI model. Prefer a recent project member solely
  // as the audit actor required by file/job foreign keys.
  const { data } = await admin.from("project_members").select("user_id")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.user_id as string | undefined ?? null;
}
