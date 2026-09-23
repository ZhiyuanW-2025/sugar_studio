import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import {
  Agent,
  generateTraceId,
  getGlobalTraceProvider,
  MemorySession,
  OpenAIProvider,
  Runner,
  setTracingContextStorage,
  type AgentInputItem,
  type Tool,
} from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelAgentType } from "../model-config/catalog";
import type { StoredMessage } from "./thread-service";
import { createGetProjectContextTool } from "./tools/get-project-context";
import { createProposeFeishuKnowledgeChangeTool } from "./tools/propose-feishu-knowledge-change";
import { createSearchProjectKnowledgeTool } from "./tools/search-project-knowledge";
import { createSearchAgentGeneralKnowledgeTool } from "./tools/search-agent-general-knowledge";
import { createSaveKnowledgeFileDescriptionsTool, type KnowledgeAttachmentContext } from "./tools/save-knowledge-file-descriptions";
import { adaptiveResponseStyleInstructions } from "./response-style";

// Workerd supports AsyncLocalStorage.run() but intentionally does not implement
// enterWith(). A composed store keeps trace context request-safe without
// replacing or disabling SDK tracing.
const tracingStorage = new AsyncLocalStorage<unknown>();
setTracingContextStorage({
  run<Result>(store: unknown, callback: () => Result): Result {
    return tracingStorage.run(store, callback);
  },
  getStore() {
    return tracingStorage.getStore();
  },
  enterWith(store: unknown) {
    tracingStorage.run(store, () => undefined);
  },
});

export const planningAgentInstructions = `你是 Sugar Agent 中的制作人小花，是用户进入任何项目后的主 Agent 和默认工作入口。你不只负责策划：你要理解用户的真实目标，持续推进讨论，帮助用户研究问题、梳理决策、整理方案、管理项目知识，并在需要专业执行时协调工程师牛牛、艺术家小熊、客户伙伴小雪、宣传委员豆豆和金牌买手拉夫。

你的核心职责包括：
1. 作为主对话伙伴，把模糊问题变成可决策、可执行的下一步。
2. 负责项目策划，包括研究、活动概念、路线、点位、剧情、谜题、互动机制、玩家流程、体验节奏与物料玩法。
3. 读取和整理当前项目与公司知识；用户上传文件时，帮助说明用途、重点和使用限制。
4. 维护项目正式上下文，并对保存正式方案、写入飞书、交接其他 Agent 等有副作用操作生成明确的待确认动作。
5. 将已确认的工程、视觉和客户材料需求分别整理给牛牛、小熊和小雪。

你可以与用户讨论任何项目问题，但不冒充专业 Agent 完成最终执行：不直接修改代码，不代替牛牛调用 Codex；不直接生成最终视觉成果；不未经确认对外发送客户材料。

涉及当前项目事实、正式方案或当前阶段时，必须优先调用 get_project_context，不可根据模糊聊天记忆猜测。需要附件、Brief、规范或工作室资料时，调用 search_project_knowledge，并注明文件名与页码。正式项目数据与文件内容冲突时，以正式数据为准。检索不到时明确说明，不得猜测。

当用户上传文件时，系统会明确告诉你文件归档范围和索引状态。索引完成后按用户问题调用 search_project_knowledge 阅读；仍在索引时如实说明，不得假装已经读过，也不能自行改变归档范围。

聊天讨论不会自动成为正式项目知识。飞书操作遵循“用户的明确指令就是本次授权”：目标和内容清楚时直接执行，不重复要求确认；用户要求先看草稿、暂不执行或内容仍有歧义时，才生成与本次回复对应的临时确认动作。不要只用文字说“请点击按钮”：只有工具成功返回 pending_confirmation 后才能提示确认；工具返回 applied 时必须如实说明已完成。状态询问不是新的执行授权，不得重复操作。保存正式方案、发送 Agent 任务和对外交付继续遵循各自的确认规则。

使用中文，表达简洁、直接、自然，像真正负责推进项目的制作人。信息不足时只提出最少量、可执行的澄清问题。输出尽量形成明确下一步或可确认成果。`;

export type RunSugarAgentInput = {
  agentType: ModelAgentType;
  agentName: string;
  workflowName: string;
  message: string;
  history: Pick<StoredMessage, "role" | "content">[];
  model: string;
  apiKey: string;
  instructions: string;
  includeProjectContextTool?: boolean;
  includeKnowledgeTool?: boolean;
  includeAgentGeneralKnowledgeTool?: boolean;
  includeFeishuWriteTool?: boolean;
  knowledgeAttachments?: KnowledgeAttachmentContext[];
  runtimeTools?: Tool[];
  additionalTools?: Tool[];
  collectAdditionalToolCalls?: () => string[];
  includeResponseStyle?: boolean;
  maxTurns?: number;
  projectContext: {
    supabase: SupabaseClient;
    userId: string;
    projectId: string;
  };
};

export type PlanningAgentRun = {
  reply: string;
  toolCalls: string[];
  actionProposalIds: string[];
  traceId: string;
};

/**
 * Execute one stateless planning turn with a request-scoped OpenAI provider.
 *
 * apiKey is deliberately accepted only by this server-only module. The caller
 * must never serialize it into a response or write it to logs.
 */
export async function runSugarAgent({
  agentType,
  agentName,
  workflowName,
  message,
  history,
  model,
  apiKey,
  instructions,
  includeProjectContextTool = true,
  includeKnowledgeTool = true,
  includeAgentGeneralKnowledgeTool = true,
  includeFeishuWriteTool = true,
  maxTurns = 5,
  projectContext,
  knowledgeAttachments = [],
  runtimeTools = [],
  additionalTools = [],
  collectAdditionalToolCalls,
  includeResponseStyle = true,
}: RunSugarAgentInput): Promise<PlanningAgentRun> {
  const traceId = generateTraceId();
  const provider = new OpenAIProvider({
    apiKey,
    useResponses: true,
  });
  const runner = new Runner({
    model,
    modelProvider: provider,
    workflowName,
    traceId,
    tracing: { apiKey },
  });
  let projectContextCallCount = 0;
  let projectKnowledgeCallCount = 0;
  let agentGeneralKnowledgeCallCount = 0;
  let feishuProposalCallCount = 0;
  const actionProposalIds: string[] = [];
  let knowledgeDescriptionCallCount = 0;
  const projectContextTool = createGetProjectContextTool({
    ...projectContext,
    onExecute: () => {
      projectContextCallCount += 1;
    },
  });
  const projectKnowledgeTool = createSearchProjectKnowledgeTool({
    ...projectContext,
    apiKey,
    onExecute: () => {
      projectKnowledgeCallCount += 1;
    },
  });
  const agentGeneralKnowledgeTool = createSearchAgentGeneralKnowledgeTool({
    supabase: projectContext.supabase,
    agentType,
    apiKey,
    onExecute: () => {
      agentGeneralKnowledgeCallCount += 1;
    },
  });
  const feishuProposalTool = createProposeFeishuKnowledgeChangeTool({
    userId: projectContext.userId,
    projectId: projectContext.projectId,
    agentType,
    supabase: projectContext.supabase,
    onExecute: (proposalId) => {
      feishuProposalCallCount += 1;
      if (proposalId) actionProposalIds.push(proposalId);
    },
  });
  const knowledgeDescriptionTool = knowledgeAttachments.length > 0
    ? createSaveKnowledgeFileDescriptionsTool({
        supabase: projectContext.supabase,
        allowedDocuments: knowledgeAttachments,
        onExecute: () => { knowledgeDescriptionCallCount += 1; },
      })
    : null;
  const tools = [
    ...(includeProjectContextTool ? [projectContextTool] : []),
    ...(includeKnowledgeTool ? [projectKnowledgeTool] : []),
    ...(includeAgentGeneralKnowledgeTool ? [agentGeneralKnowledgeTool] : []),
    ...(includeFeishuWriteTool ? [feishuProposalTool] : []),
    ...(knowledgeDescriptionTool ? [knowledgeDescriptionTool] : []),
    ...runtimeTools,
    ...additionalTools,
  ];
  const attachmentInstructions = knowledgeAttachments.length > 0
    ? `\n\n本轮有 ${knowledgeAttachments.length} 份已由服务端校验的上传文件：\n${knowledgeAttachments.map((item) => `- document_id=${item.documentId}；文件=${item.fileName}；归档状态=${item.scope}；索引=${item.indexStatus}`).join("\n")}\n归档位置完全由用户在界面选择。你不得猜测、推荐、询问或擅自改变归档位置。用户原始说明已由服务端原样绑定到文件，你不得改写。你必须为每份文件调用一次 save_knowledge_file_descriptions（可在一次工具调用中批量保存），agent_summary 必须写清用途、重点、使用限制。服务端会把可用正文节选一并提供给你；状态为 pending 时只能依据用户说明，并在摘要中明确“正文仍在解析，摘要待补充”，不得假装读过。`
    : "";
  const responseStyle = includeResponseStyle ? `\n\n${adaptiveResponseStyleInstructions}` : "";
  const effectiveInstructions = `${instructions}\n\n当前项目还可能连接飞书云盘。需要查找图片、音频、视频、素材文件夹或它们的大致内容时，调用 search_project_knowledge；只依据工具返回的媒体摘要和路径回答，不得假装读取未被索引的原文件。\n\n飞书企业知识库是公司正式外部知识源。使用 manage_feishu_knowledge 处理飞书写入。用户明确说“上传到飞书”“写入飞书”“同步到飞书”“创建/追加/修改飞书文档”时，这条指令本身就是授权，execution_mode 必须使用 execute_now，直接执行并根据工具返回的真实状态回答，不得再要求二次确认。只有用户明确要求先看草稿、先预览、暂不执行，或者目标/内容仍有歧义时，才使用 request_confirmation；只有工具返回 pending_confirmation 后才能说确认卡已经出现。用户问“上传了吗”“成功了吗”“现在在飞书里吗”属于状态询问，不是新的写入命令，不得因此重复创建或上传。用户说“这个文件”“原文件”“上传文件”时，必须先通过 search_project_knowledge 找到准确文件并使用 action=upload_file 和对应 document_id；绝不能把聊天回复作为文件正文创建文本飞书文档。只有用户明确要求把一段文本整理成飞书文档时才使用 create_document。普通讨论、项目方案保存和 Sugar Agent 内部知识更新不得调用。修改已有文档前应先检索准确标题。不得删除文档、移动节点或修改权限。${attachmentInstructions}${responseStyle}`;
  const agent = new Agent({
    name: agentName,
    instructions: effectiveInstructions,
    model,
    tools,
  });

  try {
    const initialItems: AgentInputItem[] = history.map(({ role, content }) => {
      if (role === "user") {
        return { role: "user", content: [{ type: "input_text", text: content }] };
      }
      if (role === "assistant") {
        return {
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: content }],
        };
      }
      return { role: "system", content };
    });
    const result = initialItems.length === 0
      ? await runner.run(agent, message, {
          maxTurns,
        })
      : await runner.run(agent, message, {
          maxTurns,
          session: new MemorySession({ initialItems }),
        });
    const output = result.finalOutput;

    if (typeof output !== "string" || !output.trim()) {
      throw new Error("Agent returned no text output.");
    }

    return {
      reply: output.trim(),
      toolCalls: [
        ...Array.from({ length: projectContextCallCount }, () => "get_project_context"),
        ...Array.from({ length: projectKnowledgeCallCount }, () => "search_project_knowledge"),
        ...Array.from({ length: agentGeneralKnowledgeCallCount }, () => "search_agent_general_knowledge"),
        ...Array.from({ length: feishuProposalCallCount }, () => "manage_feishu_knowledge"),
        ...Array.from({ length: knowledgeDescriptionCallCount }, () => "save_knowledge_file_descriptions"),
        ...(collectAdditionalToolCalls?.() ?? []),
      ],
      actionProposalIds,
      traceId,
    };
  } finally {
    // Workerd does not run the SDK's automatic export loop. Flush completed
    // spans before the request can end, including traces for failed Agent runs.
    // Telemetry is best-effort: an exporter/network failure must never turn an
    // otherwise successful Agent response into a user-facing 502.
    try {
      await getGlobalTraceProvider().forceFlush();
    } catch (error) {
      const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
      console.error("[agent tracing] forceFlush failed", {
        name: error instanceof Error ? error.name : "UnknownError",
        status: typeof details.status === "number" ? details.status : undefined,
        code: typeof details.code === "string" ? details.code : undefined,
      });
    }
    try {
      await provider.close();
    } catch (error) {
      const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
      console.error("[agent provider] close failed", {
        name: error instanceof Error ? error.name : "UnknownError",
        status: typeof details.status === "number" ? details.status : undefined,
        code: typeof details.code === "string" ? details.code : undefined,
      });
    }
  }
}

type RunPlanningAgentInput = Omit<RunSugarAgentInput, "agentType" | "agentName" | "workflowName" | "instructions"> & {
  instructions?: string;
};

export function runPlanningAgent(input: RunPlanningAgentInput) {
  return runSugarAgent({
    ...input,
    agentType: "planning",
    agentName: "制作人小花",
    workflowName: "Sugar Agent · 制作人小花",
    instructions: input.instructions ?? planningAgentInstructions,
  });
}
