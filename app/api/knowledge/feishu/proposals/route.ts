import { WorkspaceAccessError, requireWorkspaceMember } from "../../../../../lib/knowledge/access";
import { FeishuConfigError } from "../../../../../lib/feishu/config";
import { createFeishuChangeProposal, FeishuProposalError, type FeishuProposalAction } from "../../../../../lib/feishu/proposal-service";
import { isUuid } from "../../../../../lib/model-config/http";
import { modelAgentTypes, type ModelAgentType } from "../../../../../lib/model-config/catalog";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const { supabase } = await requireWorkspaceMember();
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const agentType = url.searchParams.get("agentType");
    let query = supabase.from("feishu_knowledge_change_proposals")
      .select("id, requested_by, project_id, agent_type, action, document_title, change_summary, content, old_text, new_text, source_knowledge_document_id, source_assistant_message_id, status, result_url, error_message, applied_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    if (projectId && isUuid(projectId)) query = query.eq("project_id", projectId);
    if (agentType && modelAgentTypes.includes(agentType as ModelAgentType)) query = query.eq("agent_type", agentType);
    const { data, error } = await query;
    if (error) throw new Error("FEISHU_PROPOSAL_LIST_FAILED");
    const proposalIds = (data ?? []).map((item) => item.id);
    const sourceDocumentIds = [...new Set((data ?? []).flatMap((item) => item.source_knowledge_document_id ? [item.source_knowledge_document_id] : []))];
    const sourceNames = new Map<string, string>();
    if (sourceDocumentIds.length) {
      const { data: documents } = await supabase.from("knowledge_documents")
        .select("id, project_file_id, company_file_id").in("id", sourceDocumentIds);
      const projectFileIds = (documents ?? []).flatMap((item) => item.project_file_id ? [item.project_file_id] : []);
      const companyFileIds = (documents ?? []).flatMap((item) => item.company_file_id ? [item.company_file_id] : []);
      const [projectFiles, companyFiles] = await Promise.all([
        projectFileIds.length ? supabase.from("project_files").select("id, file_name").in("id", projectFileIds) : Promise.resolve({ data: [] }),
        companyFileIds.length ? supabase.from("company_files").select("id, file_name").in("id", companyFileIds) : Promise.resolve({ data: [] }),
      ]);
      const fileNames = new Map([...(projectFiles.data ?? []), ...(companyFiles.data ?? [])].map((file) => [file.id, file.file_name]));
      for (const document of documents ?? []) sourceNames.set(document.id, fileNames.get(document.project_file_id ?? document.company_file_id ?? "") ?? "知识文件");
    }
    const { data: conflicts } = proposalIds.length
      ? await supabase.from("feishu_merge_conflicts")
          .select("id, proposal_id, base_revision, live_revision, base_blocks, live_blocks, proposed_change, conflicting_block_ids, status")
          .in("proposal_id", proposalIds).eq("status", "pending")
      : { data: [] };
    const conflictByProposal = new Map((conflicts ?? []).map((conflict) => [conflict.proposal_id, conflict]));
    return Response.json({
      proposals: (data ?? []).map((proposal) => ({
        ...proposal,
        source_file_name: proposal.source_knowledge_document_id ? sourceNames.get(proposal.source_knowledge_document_id) ?? "知识文件" : null,
        conflict: conflictByProposal.get(proposal.id) ?? null,
      })),
    }, { headers });
  } catch (error) {
    if (!(error instanceof WorkspaceAccessError)) {
      console.error("[feishu-proposals] list failed", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : "Unknown proposal list error",
      });
    }
    const status = error instanceof WorkspaceAccessError ? error.status : 500;
    const message = error instanceof WorkspaceAccessError ? error.message : "暂时无法加载飞书知识变更。";
    return Response.json({ error: message }, { status, headers });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireWorkspaceMember();
    const body = await request.json().catch(() => null);
    const projectId = isUuid(body?.projectId) ? body.projectId as string : null;
    const agentType = modelAgentTypes.includes(body?.agentType as ModelAgentType) ? body.agentType as ModelAgentType : null;
    const action = ["create_document", "append_content", "replace_text", "upload_file"].includes(body?.action) ? body.action as FeishuProposalAction : null;
    const sourceAssistantMessageId = isUuid(body?.sourceAssistantMessageId) ? body.sourceAssistantMessageId as string : null;
    if (!agentType || !action || typeof body?.documentTitle !== "string" || typeof body?.changeSummary !== "string") {
      return Response.json({ error: "飞书知识变更内容无效。" }, { status: 400, headers });
    }
    if (projectId) {
      const { data: membership } = await supabase.from("project_members").select("id").eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
      if (!membership) return Response.json({ error: "你不是该项目成员。" }, { status: 403, headers });
    }
    if (sourceAssistantMessageId) {
      const { data: sourceMessage } = await supabase.from("messages")
        .select("id, role, thread:agent_threads!inner(project_id, user_id, agent_type)")
        .eq("id", sourceAssistantMessageId)
        .eq("role", "assistant")
        .maybeSingle();
      const thread = sourceMessage?.thread as unknown as { project_id: string; user_id: string; agent_type: string } | null;
      if (!sourceMessage || !thread || thread.user_id !== user.id || thread.project_id !== projectId || thread.agent_type !== agentType) {
        return Response.json({ error: "无法把这项操作关联到当前回复。" }, { status: 403, headers });
      }
    }
    const proposal = await createFeishuChangeProposal({
      requestedBy: user.id,
      projectId,
      agentType,
      action,
      documentTitle: body.documentTitle,
      changeSummary: body.changeSummary,
      content: typeof body.content === "string" ? body.content : null,
      oldText: typeof body.oldText === "string" ? body.oldText : null,
      newText: typeof body.newText === "string" ? body.newText : null,
      sourceKnowledgeDocumentId: isUuid(body?.sourceDocumentId) ? body.sourceDocumentId : null,
      sourceAssistantMessageId,
    });
    return Response.json({ proposal }, { status: 201, headers });
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status
      : error instanceof FeishuConfigError ? 409
        : error instanceof FeishuProposalError ? error.code === "not_found" ? 404 : error.code === "not_configured" ? 409 : 400
          : 500;
    const message = error instanceof WorkspaceAccessError || error instanceof FeishuConfigError || error instanceof FeishuProposalError
      ? error.message
      : "暂时无法创建飞书知识变更。";
    return Response.json({ error: message }, { status, headers });
  }
}
