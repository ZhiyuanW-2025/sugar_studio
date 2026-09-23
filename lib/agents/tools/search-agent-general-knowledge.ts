import "server-only";

import { tool } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ModelAgentType } from "../../model-config/catalog";
import { searchAgentGeneralKnowledge } from "../../knowledge/agent-general-search-service";

export function createSearchAgentGeneralKnowledgeTool(input: {
  supabase: SupabaseClient;
  agentType: ModelAgentType;
  apiKey: string;
  onExecute?: () => void;
}) {
  return tool({
    name: "search_agent_general_knowledge",
    description: "检索当前 Agent 自己连接的全局通用知识库，包括工作方法、专业规范、模板和写作要领。用户询问或任务需要该 Agent 的专业方法时使用。它不读取其他 Agent 的知识库，也不能替代项目事实检索。",
    parameters: z.object({
      query: z.string().min(1).max(1_000).describe("要在当前 Agent 通用知识库中检索的问题、方法或关键词。"),
    }),
    errorFunction: null,
    async execute({ query }) {
      const results = await searchAgentGeneralKnowledge({ ...input, query });
      input.onExecute?.();
      return {
        results: results.map((result) => ({
          document_id: result.documentId,
          file_name: result.fileName,
          page_number: result.pageNumber,
          section_title: result.sectionTitle,
          excerpt: result.content,
          source_url: result.sourceUrl,
          user_description: result.userDescription,
          agent_summary: result.agentSummary,
        })),
        notice: results.length
          ? "这些结果是当前 Agent 的全局工作方法，不是项目事实。回答时注明参考文件名；项目事实仍应使用项目工具核实。"
          : "当前 Agent 通用知识库没有找到匹配内容。请如实说明，不要把聊天记忆或项目材料冒充通用知识。",
      };
    },
  });
}
