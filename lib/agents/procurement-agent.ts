import "server-only";

import { runSugarAgent, type RunSugarAgentInput } from "./planning-agent";
import { createSaveProcurementCandidatesTool } from "./tools/save-procurement-candidates";
import { createSearch1688ProductsTool } from "./tools/search-1688-products";
import { createGetProcurementSearchArchiveTool } from "./tools/get-procurement-search-archive";
import { createGetProcurementInquiryContextTool } from "./tools/get-procurement-inquiry-context";
import { createSendProcurementFollowUpTool } from "./tools/send-procurement-follow-up";

export const procurementAgentInstructions = `你是 Sugar Agent 中的金牌买手拉夫，是工作室的专业采购 Agent。你负责根据项目需求在 1688 找品、筛选供应商、比较价格、起订量、销量、履约表现与定制能力，并给出可供人判断的采购候选。

当用户提出真实找品需求时，先把自然语言整理为清晰采购条件，再调用 search_1688_products。优先检查数量、预算、规格、材质、尺寸、交期和定制要求等硬条件，不得只按接口原始排序推荐。最终重点比较 3–8 个候选，明确逐项说明哪些条件满足、哪些不满足或接口没有返回。接口没提供的信息绝不能猜测；价格和库存可能变化，应提醒用户在采购前复核。

每次找品的全部标准化结果都会由系统自动永久归档。用户说“刚才那几家”“之前搜到的”“保存新五家”等引用历史结果时，必须先调用 get_procurement_search_archive 找到准确商品，再用 search_result_ids 调用 save_procurement_candidates；不得重新搜索或凭标题猜测。

你可以帮助用户拟定询盘问题、比较多家商家的回复并提出追问建议。首次联系商家必须通过采购工作区的确认发送动作完成。已经存在询价记录的单厂家后续追问，按下面的厂家引用规则处理。一次首次询价最多联系 10 家。询盘阶段不得下单、不得付款，也不得承诺最终采购。用户提出自动下单或自动付款时，明确说明当前阶段尚未开放。

用户从右侧引用某个厂家询价记录时，先调用 get_procurement_inquiry_context 读取该厂家的完整记录，只围绕这一家讨论下一轮目标。讨论、分析或拟问题时不得联系商家。只有用户在当前一轮明确说“发送”“去问”“就按这个追问”等授权话语时，才可调用 send_procurement_follow_up；发送后如实告诉用户已经联系哪家厂商和实际问题。不得把一家厂商的记录或问题混入另一家。

涉及当前项目事实、当前阶段或正式方案时，调用 get_project_context；需要从项目材料中提取采购条件时，调用 search_project_knowledge。输出使用简洁、专业的中文，先给结论和重点候选，再给横向比较与风险。`;

type Input = Omit<RunSugarAgentInput, "agentType" | "agentName" | "workflowName" | "instructions"> & {
  instructions?: string;
  thread?: { id: string };
};

export function runProcurementAgent(input: Input) {
  let searchCalls = 0;
  let saveCalls = 0;
  let archiveCalls = 0;
  let inquiryContextCalls = 0;
  let followUpCalls = 0;
  return runSugarAgent({
    ...input,
    agentType: "procurement",
    agentName: "金牌买手拉夫",
    workflowName: "Sugar Agent · 金牌买手拉夫",
    instructions: input.instructions ?? procurementAgentInstructions,
    includeFeishuWriteTool: false,
    maxTurns: 10,
    additionalTools: [
      createSearch1688ProductsTool({
        projectId: input.projectContext.projectId,
        userId: input.projectContext.userId,
        threadId: input.thread?.id ?? null,
        onExecute: () => { searchCalls += 1; },
      }),
      createGetProcurementSearchArchiveTool({
        supabase: input.projectContext.supabase,
        projectId: input.projectContext.projectId,
        onExecute: () => { archiveCalls += 1; },
      }),
      createSaveProcurementCandidatesTool({
        ...input.projectContext,
        onExecute: () => { saveCalls += 1; },
      }),
      createGetProcurementInquiryContextTool({
        supabase: input.projectContext.supabase,
        projectId: input.projectContext.projectId,
        onExecute: () => { inquiryContextCalls += 1; },
      }),
      createSendProcurementFollowUpTool({
        supabase: input.projectContext.supabase,
        projectId: input.projectContext.projectId,
        userId: input.projectContext.userId,
        threadId: input.thread?.id ?? null,
        currentUserMessage: input.message,
        onExecute: () => { followUpCalls += 1; },
      }),
    ],
    collectAdditionalToolCalls: () => [
      ...Array.from({ length: searchCalls }, () => "search_1688_products"),
      ...Array.from({ length: archiveCalls }, () => "get_procurement_search_archive"),
      ...Array.from({ length: saveCalls }, () => "save_procurement_candidates"),
      ...Array.from({ length: inquiryContextCalls }, () => "get_procurement_inquiry_context"),
      ...Array.from({ length: followUpCalls }, () => "send_procurement_follow_up"),
    ],
  });
}
