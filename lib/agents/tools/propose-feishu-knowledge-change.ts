import "server-only";

import { tool } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelAgentType } from "../../model-config/catalog";
import { z } from "zod";
import { applyFeishuChangeProposal, createFeishuChangeProposal } from "../../feishu/proposal-service";
import { indexKnowledgeDocument } from "../../knowledge/service";

const parameters = z.object({
  action: z.enum(["create_document", "append_content", "replace_text", "upload_file"]).describe("创建文本新文档、追加内容、替换文本块，或把知识库中的原文件上传到飞书。"),
  document_title: z.string().min(1).max(240).describe("新文档标题，或已有飞书文档的完整准确标题。"),
  change_summary: z.string().min(1).max(1_000).describe("给用户看的简短变更说明。"),
  content: z.string().max(40_000).nullable().describe("create_document 或 append_content 要写入的正文；replace_text 时为 null。"),
  old_text: z.string().max(8_000).nullable().describe("replace_text 时要替换的完整原段落，其他操作为 null。"),
  new_text: z.string().max(8_000).nullable().describe("replace_text 时替换后的完整段落，其他操作为 null。"),
  source_document_id: z.string().uuid().nullable().describe("upload_file 时必须填写 search_project_knowledge 返回的 document_id；其他操作为 null。"),
  execution_mode: z.enum(["execute_now", "request_confirmation"]).describe("用户已明确命令写入/上传/修改时使用 execute_now；只有用户尚未授权执行、明确要求先预览或操作内容仍有歧义时才使用 request_confirmation。"),
});

const outputSchema = z.object({
  status: z.enum(["applied", "pending_confirmation", "error"]),
  proposal_id: z.string().nullable(),
  result_url: z.string().nullable(),
  notice: z.string(),
});

export function createProposeFeishuKnowledgeChangeTool(input: {
  userId: string;
  projectId: string;
  agentType: ModelAgentType;
  supabase: SupabaseClient;
  onExecute?: (proposalId?: string) => void;
}) {
  return tool({
    name: "manage_feishu_knowledge",
    description: "执行或准备飞书知识库操作。用户的明确命令本身就是授权，必须使用 execute_now 直接完成，不再二次确认；只有用户要求预览/草稿、尚未授权执行或目标仍有歧义时使用 request_confirmation，并在对应回复下生成真实确认卡。状态询问（如“上传了吗”）不是新的写入命令，不应调用本工具。发布原文件必须使用 upload_file 和准确 document_id，不能把聊天回复冒充原文件。",
    parameters,
    outputSchema,
    errorFunction: null,
    async execute(args) {
      let proposalId: string | undefined;
      try {
        const proposal = await createFeishuChangeProposal({
          requestedBy: input.userId,
          projectId: input.projectId,
          agentType: input.agentType,
          action: args.action,
          documentTitle: args.document_title,
          changeSummary: args.change_summary,
          content: args.content,
          oldText: args.old_text,
          newText: args.new_text,
          sourceKnowledgeDocumentId: args.source_document_id,
        });
        proposalId = proposal.id;
        input.onExecute?.(proposal.id);
        if (args.execution_mode === "execute_now") {
          const applied = await applyFeishuChangeProposal({ proposalId: proposal.id, appliedBy: input.userId });
          if (applied.synced?.documentId) {
            await indexKnowledgeDocument({
              supabase: input.supabase,
              userId: input.userId,
              documentId: applied.synced.documentId,
            }).catch(() => undefined);
          }
          return {
            status: "applied" as const,
            proposal_id: proposal.id,
            result_url: applied.node?.url ?? null,
            notice: applied.node?.url
              ? `飞书操作已完成。可以把实际结果和链接 ${applied.node.url} 告诉用户；不要再要求确认。`
              : "飞书操作已完成。请告诉用户实际结果；不要再要求确认。",
          };
        }
        return {
          status: "pending_confirmation" as const,
          proposal_id: proposal.id,
          result_url: null,
          notice: "真实的待确认操作卡已经绑定到本条回复。可以请用户使用卡片中的确认按钮；不得声称已经写入。",
        };
      } catch (error) {
        if (!proposalId) input.onExecute?.();
        return {
          status: "error" as const,
          proposal_id: proposalId ?? null,
          result_url: null,
          notice: error instanceof Error ? error.message : "暂时无法创建飞书知识变更。",
        };
      }
    },
  });
}
