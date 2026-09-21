import "server-only";

import { tool } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type KnowledgeAttachmentContext = {
  documentId: string;
  fileName: string;
  scope: "project" | "company" | "feishu" | "unarchived";
  indexStatus: "ready" | "pending";
};

const parameters = z.object({
  files: z.array(z.object({
    document_id: z.string().uuid(),
    agent_summary: z.string().max(8_000).describe("小花整理的用途、重点和使用限制。没有读到正文时必须明确标注仅依据用户说明。"),
  })).min(1).max(5),
});

export function createSaveKnowledgeFileDescriptionsTool(input: {
  supabase: SupabaseClient;
  allowedDocuments: KnowledgeAttachmentContext[];
  onExecute?: () => void;
}) {
  const allowed = new Set(input.allowedDocuments.map((item) => item.documentId));
  return tool({
    name: "save_knowledge_file_descriptions",
    description: "把小花对本轮上传文件的用途、重点和使用限制总结永久绑定到对应知识文件。用户原始说明已由服务端原样保存，不能由 Agent 改写。",
    parameters,
    errorFunction: null,
    async execute({ files }) {
      if (files.some((file) => !allowed.has(file.document_id))) throw new Error("KNOWLEDGE_DOCUMENT_NOT_ALLOWED");
      for (const file of files) {
        const { error } = await input.supabase.rpc("update_knowledge_document_descriptions", {
          p_document_id: file.document_id,
          p_user_description: null,
          p_agent_summary: file.agent_summary,
        });
        if (error) throw new Error("KNOWLEDGE_DESCRIPTION_SAVE_FAILED");
      }
      input.onExecute?.();
      return { saved: true, count: files.length };
    },
  });
}
