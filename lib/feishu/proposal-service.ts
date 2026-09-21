import "server-only";

import type { ModelAgentType } from "../model-config/catalog";
import { createAdminClient } from "../supabase/admin";
import {
  appendFeishuDocumentContent,
  createFeishuWikiDocument,
  FeishuConflictError,
  getFeishuDocumentSnapshot,
  getFeishuWikiNode,
  replaceFeishuBlockById,
  uploadFileToFeishuWiki,
  type FeishuDocumentSnapshot,
  type FeishuTextBlock,
} from "./client";
import { chooseFeishuSyncScope, getFeishuSyncScope, type FeishuSyncScope } from "./scope-service";
import { captureFeishuRevision, mirrorFeishuUploadedFile, syncFeishuNode, syncFeishuNodeByToken } from "./sync-service";
import { decideFeishuTextBlockMerge } from "./merge";
import { FEISHU_UPLOAD_MAX_BYTES } from "./config";

export type FeishuProposalAction = "create_document" | "append_content" | "replace_text" | "upload_file";

export class FeishuProposalError extends Error {
  constructor(
    message: string,
    public readonly code: "not_configured" | "not_found" | "invalid" | "conflict" | "failed" = "failed",
  ) {
    super(message);
    this.name = "FeishuProposalError";
  }
}

type TargetRow = {
  id: string;
  sync_scope_id: string;
  scope_type: "company" | "project";
  project_id: string | null;
  node_token: string;
  obj_token: string;
  obj_type: "docx";
  title: string;
  external_revision: string | null;
};

type KnowledgeSource = {
  documentId: string;
  scope: "company" | "project";
  projectId: string | null;
  fileId: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  size: number;
  storagePath: string;
  storageBucket: "company-knowledge" | "project-files";
  sourceProvider: "upload" | "feishu";
  userDescription: string;
  agentSummary: string;
};

async function loadKnowledgeSource(documentId: string, requestedBy?: string): Promise<KnowledgeSource> {
  const admin = createAdminClient();
  const { data: document, error } = await admin.from("knowledge_documents")
    .select("id, scope, project_id, project_file_id, company_file_id, user_description, agent_summary")
    .eq("id", documentId).maybeSingle();
  if (error || !document) throw new FeishuProposalError("没有找到要上传的知识文件。", "not_found");
  if (requestedBy) {
    let membership = admin.from("project_members").select("id").eq("user_id", requestedBy).limit(1);
    if (document.scope === "project") membership = membership.eq("project_id", document.project_id);
    const { data: allowed } = await membership;
    if (!allowed?.length) throw new FeishuProposalError("你没有权限发布这份知识文件。", "invalid");
  }
  const table = document.scope === "company" ? "company_files" : "project_files";
  const fileId = document.scope === "company" ? document.company_file_id : document.project_file_id;
  if (!fileId) throw new FeishuProposalError("知识文件缺少原始文件。", "not_found");
  const { data: file, error: fileError } = await admin.from(table)
    .select("id, file_name, file_type, mime_type, size, storage_path, source_provider")
    .eq("id", fileId).maybeSingle();
  if (fileError || !file) throw new FeishuProposalError("没有找到要上传的原文件。", "not_found");
  if (file.size > FEISHU_UPLOAD_MAX_BYTES) throw new FeishuProposalError("飞书单文件上传上限为 20 MB。", "invalid");
  return {
    documentId: document.id,
    scope: document.scope as "company" | "project",
    projectId: document.project_id,
    fileId: file.id,
    fileName: file.file_name,
    fileType: file.file_type,
    mimeType: file.mime_type,
    size: file.size,
    storagePath: file.storage_path,
    storageBucket: document.scope === "company" ? "company-knowledge" : "project-files",
    sourceProvider: file.source_provider === "feishu" ? "feishu" : "upload",
    userDescription: document.user_description ?? "",
    agentSummary: document.agent_summary ?? "",
  };
}

function publishedFileName(title: string, fileType: string) {
  const cleanTitle = title.trim().replace(new RegExp(`\\.${fileType}$`, "i"), "");
  return `${cleanTitle}.${fileType}`;
}

async function publishKnowledgeSource(input: {
  source: KnowledgeSource;
  title: string;
  scope: FeishuSyncScope;
  appliedBy: string;
}) {
  const admin = createAdminClient();
  const { data: fileBlob, error: downloadError } = await admin.storage
    .from(input.source.storageBucket).download(input.source.storagePath);
  if (downloadError || !fileBlob) throw new FeishuProposalError("原文件暂时无法读取，请稍后重试。", "failed");
  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  if (bytes.byteLength <= 0 || bytes.byteLength > FEISHU_UPLOAD_MAX_BYTES) {
    throw new FeishuProposalError("原文件为空或超过飞书 20 MB 上传上限。", "invalid");
  }
  const fileName = publishedFileName(input.title, input.source.fileType);
  const uploaded = await uploadFileToFeishuWiki({
    fileName,
    bytes,
    mimeType: input.source.mimeType,
    scope: input.scope,
  });

  const canReuseSource = input.source.scope === input.scope.scopeType
    && (input.source.scope === "company" || input.source.projectId === input.scope.projectId);
  let mirroredFileId = input.source.fileId;
  let knowledgeDocumentId = input.source.documentId;
  if (canReuseSource) {
    const table = input.source.scope === "company" ? "company_files" : "project_files";
    const { error: updateError } = await admin.from(table).update({
      file_name: fileName,
      source_provider: "feishu",
      source_external_id: uploaded.nodeToken ?? uploaded.fileToken,
      source_url: uploaded.url,
      source_updated_at: new Date().toISOString(),
    }).eq("id", input.source.fileId);
    if (updateError) throw new FeishuProposalError("文件已上传飞书，但本地来源状态更新失败。", "failed");
  } else {
    const mirrored = await mirrorFeishuUploadedFile({
      scope: input.scope,
      fileToken: uploaded.fileToken,
      nodeToken: uploaded.nodeToken,
      sourceUrl: uploaded.url,
      fileName,
      fileType: input.source.fileType,
      mimeType: input.source.mimeType,
      bytes,
      uploadedBy: input.appliedBy,
    });
    mirroredFileId = mirrored.fileId;
    knowledgeDocumentId = mirrored.documentId;
    await admin.from("knowledge_documents").update({
      user_description: input.source.userDescription,
      agent_summary: input.source.agentSummary,
      description_updated_by: input.appliedBy,
      description_updated_at: new Date().toISOString(),
    }).eq("id", mirrored.documentId);
  }

  if (uploaded.nodeToken) {
    await syncFeishuNodeByToken({
      scopeId: input.scope.id,
      nodeToken: uploaded.nodeToken,
      requestedBy: input.appliedBy,
      force: true,
    }).catch(() => null);
    await admin.from("feishu_knowledge_documents").update(
      input.scope.scopeType === "company"
        ? { company_file_id: mirroredFileId }
        : { project_file_id: mirroredFileId },
    ).eq("sync_scope_id", input.scope.id).eq("node_token", uploaded.nodeToken);
  }
  return {
    nodeToken: uploaded.nodeToken,
    resultUrl: uploaded.url,
    taskId: uploaded.taskId,
    documentId: knowledgeDocumentId,
  };
}

async function resolveTarget(documentTitle: string, projectId: string | null): Promise<TargetRow> {
  const { data, error } = await createAdminClient().from("feishu_knowledge_documents")
    .select("id, sync_scope_id, scope_type, project_id, node_token, obj_token, obj_type, title, external_revision")
    .eq("obj_type", "docx").neq("sync_status", "removed").not("sync_scope_id", "is", null);
  if (error) throw new FeishuProposalError("暂时无法查找飞书文档。")
  const normalized = documentTitle.trim().toLocaleLowerCase("zh-CN");
  const matches = (data ?? []).filter((row) => String(row.title).trim().toLocaleLowerCase("zh-CN") === normalized) as TargetRow[];
  const projectMatches = projectId ? matches.filter((row) => row.scope_type === "project" && row.project_id === projectId) : [];
  const companyMatches = matches.filter((row) => row.scope_type === "company");
  const candidates = projectMatches.length ? projectMatches : companyMatches;
  if (candidates.length === 0) throw new FeishuProposalError(`没有找到飞书文档「${documentTitle}」，请先同步对应知识库或确认标题。`, "not_found");
  if (candidates.length > 1) throw new FeishuProposalError(`存在多个同名飞书文档「${documentTitle}」，请在知识库中调整标题后重试。`, "invalid");
  return candidates[0];
}

function findTargetBlock(blocks: FeishuTextBlock[], oldText: string) {
  const matches = blocks.filter((block) => block.text.trim() === oldText.trim());
  if (matches.length !== 1) throw new FeishuProposalError(
    matches.length ? "原文在飞书文档中出现多次，无法安全确定修改位置。" : "没有找到需要替换的完整原段落。",
    "conflict",
  );
  return matches[0];
}

async function createConflict(input: {
  proposalId: string;
  documentId: string;
  base: FeishuDocumentSnapshot;
  live: FeishuDocumentSnapshot;
  blockId: string;
  oldText: string;
  newText: string;
}) {
  const { error } = await createAdminClient().from("feishu_merge_conflicts").upsert({
    proposal_id: input.proposalId,
    document_id: input.documentId,
    base_revision: input.base.revision,
    live_revision: input.live.revision,
    base_blocks: input.base.blocks,
    live_blocks: input.live.blocks,
    proposed_change: { type: "replace_text", blockId: input.blockId, oldText: input.oldText, newText: input.newText },
    conflicting_block_ids: [input.blockId],
    status: "pending",
    resolution: null,
    resolved_content: null,
    resolved_by: null,
    resolved_at: null,
  }, { onConflict: "proposal_id" });
  if (error) throw new Error("FEISHU_CONFLICT_SAVE_FAILED");
}

export async function createFeishuChangeProposal(input: {
  requestedBy: string;
  projectId: string | null;
  agentType: ModelAgentType;
  action: FeishuProposalAction;
  documentTitle: string;
  changeSummary: string;
  content?: string | null;
  oldText?: string | null;
  newText?: string | null;
  sourceKnowledgeDocumentId?: string | null;
  sourceAssistantMessageId?: string | null;
}) {
  const title = input.documentTitle.trim().slice(0, 240);
  const summary = input.changeSummary.trim().slice(0, 1_000);
  if (!title || !summary) throw new FeishuProposalError("飞书知识变更缺少标题或说明。", "invalid");
  let target: TargetRow | null = null;
  let scope: FeishuSyncScope;
  let expectedRevision: string | null = null;
  let baseRevisionId: string | null = null;

  let sourceKnowledgeDocumentId: string | null = null;
  if (input.action === "upload_file") {
    if (!input.sourceKnowledgeDocumentId) throw new FeishuProposalError("请选择要上传到飞书的原文件。", "invalid");
    const source = await loadKnowledgeSource(input.sourceKnowledgeDocumentId, input.requestedBy);
    if (source.sourceProvider === "feishu") throw new FeishuProposalError("这份文件已经来自飞书，无需重复上传。", "invalid");
    if (source.scope === "project" && source.projectId !== input.projectId) {
      throw new FeishuProposalError("所选文件不属于当前项目。", "invalid");
    }
    sourceKnowledgeDocumentId = source.documentId;
    try {
      scope = await chooseFeishuSyncScope(source.scope === "project" ? source.projectId : null);
    } catch {
      throw new FeishuProposalError("请先在知识库设置中添加一个可写入的飞书知识范围。", "not_configured");
    }
  } else if (input.action !== "create_document") {
    target = await resolveTarget(title, input.projectId);
    scope = await getFeishuSyncScope(target.sync_scope_id);
    const node = await getFeishuWikiNode(target.node_token, scope.spaceId);
    const snapshot = await getFeishuDocumentSnapshot(node);
    expectedRevision = snapshot.revision;
    baseRevisionId = await captureFeishuRevision(target.id, snapshot, "pre_write");
    if (input.action === "replace_text" && input.oldText) findTargetBlock(snapshot.blocks, input.oldText);
  } else {
    try {
      scope = await chooseFeishuSyncScope(input.projectId);
    } catch {
      throw new FeishuProposalError("请先在知识库设置中添加一个可写入的飞书知识范围。", "not_configured");
    }
  }

  const content = input.content?.trim().slice(0, 40_000) || null;
  const oldText = input.oldText?.trim().slice(0, 8_000) || null;
  const newText = input.newText?.trim().slice(0, 8_000) || null;
  if ((input.action === "create_document" || input.action === "append_content") && !content) {
    throw new FeishuProposalError("没有可以写入飞书文档的正文。", "invalid");
  }
  if (input.action === "replace_text" && (!oldText || !newText)) {
    throw new FeishuProposalError("修改飞书文档时必须提供完整原文和替换后的文字。", "invalid");
  }

  const { data, error } = await createAdminClient().from("feishu_knowledge_change_proposals").insert({
    requested_by: input.requestedBy,
    project_id: input.projectId,
    agent_type: input.agentType,
    action: input.action,
    target_document_id: target?.id ?? null,
    sync_scope_id: scope.id,
    base_revision_id: baseRevisionId,
    document_title: title,
    change_summary: summary,
    content,
    old_text: oldText,
    new_text: newText,
    expected_revision: expectedRevision,
    source_knowledge_document_id: sourceKnowledgeDocumentId,
    source_assistant_message_id: input.sourceAssistantMessageId ?? null,
  }).select("id, action, document_title, change_summary, status, created_at").single();
  if (error || !data) throw new FeishuProposalError("暂时无法保存飞书知识变更草稿。")
  return data;
}

export async function linkFeishuChangeProposalsToMessage(input: {
  proposalIds: string[];
  requestedBy: string;
  assistantMessageId: string;
}) {
  const proposalIds = [...new Set(input.proposalIds)];
  if (proposalIds.length === 0) return;
  const { data, error } = await createAdminClient()
    .from("feishu_knowledge_change_proposals")
    .update({ source_assistant_message_id: input.assistantMessageId })
    .eq("requested_by", input.requestedBy)
    .in("id", proposalIds)
    .is("source_assistant_message_id", null)
    .select("id");
  if (error || data?.length !== proposalIds.length) {
    throw new Error("FEISHU_PROPOSAL_MESSAGE_LINK_FAILED");
  }
}

async function readBaseSnapshot(baseRevisionId: string | null): Promise<FeishuDocumentSnapshot | null> {
  if (!baseRevisionId) return null;
  const { data } = await createAdminClient().from("feishu_document_revisions")
    .select("external_revision, raw_content, blocks").eq("id", baseRevisionId).maybeSingle();
  if (!data) return null;
  return { title: "", revision: data.external_revision, content: data.raw_content, blocks: data.blocks as FeishuTextBlock[] };
}

export async function applyFeishuChangeProposal(input: { proposalId: string; appliedBy: string }) {
  const admin = createAdminClient();
  const { data: proposal, error: lookupError } = await admin.from("feishu_knowledge_change_proposals")
    .select("*, target:feishu_knowledge_documents(id, node_token, obj_token, obj_type)")
    .eq("id", input.proposalId).maybeSingle();
  if (lookupError || !proposal) throw new FeishuProposalError("没有找到这项飞书知识变更。", "not_found");
  if (proposal.status !== "pending") throw new FeishuProposalError("这项飞书知识变更已经处理，不能重复执行。", "conflict");
  const { data: claimed, error: claimError } = await admin.from("feishu_knowledge_change_proposals")
    .update({ status: "applying", error_message: null }).eq("id", input.proposalId).eq("status", "pending").select("id").maybeSingle();
  if (claimError || !claimed) throw new FeishuProposalError("这项飞书知识变更正在被其他操作处理。", "conflict");

  try {
    const scope = await getFeishuSyncScope(proposal.sync_scope_id);
    if (proposal.action === "upload_file") {
      // The proposal creator's project access was validated when the immutable
      // source document was attached. Any workspace member may confirm it,
      // matching the product's equal member permissions.
      const source = await loadKnowledgeSource(proposal.source_knowledge_document_id, proposal.requested_by);
      const published = await publishKnowledgeSource({ source, title: proposal.document_title, scope, appliedBy: input.appliedBy });
      const appliedAt = new Date().toISOString();
      const { error: saveError } = await admin.from("feishu_knowledge_change_proposals").update({
        status: "applied",
        result_node_token: published.nodeToken,
        result_url: published.resultUrl,
        applied_by: input.appliedBy,
        applied_at: appliedAt,
        error_message: null,
      }).eq("id", input.proposalId);
      if (saveError) throw new Error("FEISHU_PROPOSAL_FINALIZE_FAILED");
      return {
        proposalId: input.proposalId,
        node: { nodeToken: published.nodeToken, url: published.resultUrl, taskId: published.taskId },
        synced: { documentId: published.documentId, status: published.taskId ? "processing" : "ready" },
      };
    }
    let node;
    if (proposal.action === "create_document") {
      node = await createFeishuWikiDocument(proposal.document_title, scope);
      await appendFeishuDocumentContent(node.objToken, proposal.content);
    } else {
      const target = proposal.target as { id?: string; node_token?: string; obj_token?: string; obj_type?: string } | null;
      if (!target?.id || !target.node_token || !target.obj_token || target.obj_type !== "docx") throw new FeishuProposalError("目标飞书文档已经不存在。", "not_found");
      node = await getFeishuWikiNode(target.node_token, scope.spaceId);
      const live = await getFeishuDocumentSnapshot(node);
      if (proposal.action === "append_content") {
        // Appending creates new blocks, so edits to existing blocks can merge safely.
        await appendFeishuDocumentContent(node.objToken, proposal.content, live.revision);
      } else {
        const base = await readBaseSnapshot(proposal.base_revision_id);
        if (!base) throw new FeishuProposalError("找不到该变更的基础版本，请重新生成变更。", "conflict");
        const baseBlock = findTargetBlock(base.blocks, proposal.old_text);
        const merge = decideFeishuTextBlockMerge({ blockId: baseBlock.blockId, baseText: baseBlock.text, liveBlocks: live.blocks });
        if (merge.kind === "conflict") {
          await createConflict({
            proposalId: proposal.id,
            documentId: target.id,
            base,
            live,
            blockId: baseBlock.blockId,
            oldText: proposal.old_text,
            newText: proposal.new_text,
          });
          throw new FeishuConflictError("飞书中的同一段内容也被修改了，请选择保留哪一版。");
        }
        // Other blocks may have changed; updating the unchanged target block is a safe automatic merge.
        await replaceFeishuBlockById({ documentId: node.objToken, blockId: baseBlock.blockId, newText: proposal.new_text, revision: live.revision });
      }
    }

    const freshNode = await getFeishuWikiNode(node.nodeToken, scope.spaceId);
    const synced = await syncFeishuNode({ scope, node: freshNode, requestedBy: input.appliedBy, force: true, revisionSource: "post_write" });
    const appliedAt = new Date().toISOString();
    const { error: saveError } = await admin.from("feishu_knowledge_change_proposals").update({
      status: "applied", result_node_token: freshNode.nodeToken, result_url: freshNode.url,
      applied_by: input.appliedBy, applied_at: appliedAt, error_message: null,
    }).eq("id", input.proposalId);
    if (saveError) throw new Error("FEISHU_PROPOSAL_FINALIZE_FAILED");
    return { proposalId: input.proposalId, node: freshNode, synced };
  } catch (error) {
    const conflict = error instanceof FeishuConflictError || (error instanceof FeishuProposalError && error.code === "conflict");
    const safeMessage = conflict ? error.message : error instanceof FeishuProposalError ? error.message : "飞书知识写入失败，请检查连接和文档权限后重试。";
    await admin.from("feishu_knowledge_change_proposals").update({
      status: conflict ? "conflict" : "failed", error_message: safeMessage,
    }).eq("id", input.proposalId);
    throw new FeishuProposalError(safeMessage, conflict ? "conflict" : "failed");
  }
}

export async function resolveFeishuMergeConflict(input: {
  conflictId: string;
  resolvedBy: string;
  resolution: "agent" | "feishu" | "custom";
  customContent?: string | null;
}) {
  const admin = createAdminClient();
  const { data: conflict, error } = await admin.from("feishu_merge_conflicts")
    .select("*, proposal:feishu_knowledge_change_proposals(id, target_document_id, sync_scope_id, new_text), document:feishu_knowledge_documents(node_token, obj_token)")
    .eq("id", input.conflictId).eq("status", "pending").maybeSingle();
  if (error || !conflict) throw new FeishuProposalError("没有找到待处理的冲突。", "not_found");
  const proposal = conflict.proposal as { id: string; sync_scope_id: string; new_text: string };
  const document = conflict.document as { node_token: string; obj_token: string };
  const change = conflict.proposed_change as { blockId?: string; newText?: string };
  if (!change.blockId) throw new FeishuProposalError("冲突信息不完整，请重新生成变更。", "invalid");
  const scope = await getFeishuSyncScope(proposal.sync_scope_id);
  const node = await getFeishuWikiNode(document.node_token, scope.spaceId);
  const live = await getFeishuDocumentSnapshot(node);
  if (live.revision !== conflict.live_revision) {
    throw new FeishuProposalError("飞书文档在冲突出现后又发生了变化，请重新检查。", "conflict");
  }
  let resolvedContent: string | null = null;
  if (input.resolution !== "feishu") {
    resolvedContent = input.resolution === "custom" ? input.customContent?.trim() || null : change.newText || proposal.new_text;
    if (!resolvedContent) throw new FeishuProposalError("请填写最终采用的段落内容。", "invalid");
    await replaceFeishuBlockById({ documentId: document.obj_token, blockId: change.blockId, newText: resolvedContent, revision: live.revision });
  }
  const freshNode = await getFeishuWikiNode(document.node_token, scope.spaceId);
  const synced = await syncFeishuNode({ scope, node: freshNode, requestedBy: input.resolvedBy, force: true, revisionSource: "post_write" });
  const resolvedAt = new Date().toISOString();
  await admin.from("feishu_merge_conflicts").update({
    status: "resolved", resolution: input.resolution, resolved_content: resolvedContent,
    resolved_by: input.resolvedBy, resolved_at: resolvedAt,
  }).eq("id", input.conflictId);
  await admin.from("feishu_knowledge_change_proposals").update({
    status: "applied", applied_by: input.resolvedBy, applied_at: resolvedAt,
    result_node_token: freshNode.nodeToken, result_url: freshNode.url, error_message: null,
  }).eq("id", proposal.id);
  return { synced, node: freshNode };
}

export async function cancelFeishuChangeProposal(proposalId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("feishu_knowledge_change_proposals")
    .update({ status: "cancelled", error_message: null }).eq("id", proposalId)
    .in("status", ["pending", "conflict"]).select("id").maybeSingle();
  if (error || !data) throw new FeishuProposalError("这项变更已经处理，无法取消。", "conflict");
  await admin.from("feishu_merge_conflicts").update({ status: "cancelled" }).eq("proposal_id", proposalId).eq("status", "pending");
}
