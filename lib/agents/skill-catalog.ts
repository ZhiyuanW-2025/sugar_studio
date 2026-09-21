import type { ModelAgentType } from "../model-config/catalog";

export type AgentSkillToolOption = { value: string; label: string };

const commonTools: AgentSkillToolOption[] = [
  { value: "get_project_context", label: "读取正式项目概况" },
  { value: "search_project_knowledge", label: "检索项目材料与知识" },
];

export const agentSkillToolOptions: Record<ModelAgentType, AgentSkillToolOption[]> = {
  planning: [...commonTools, { value: "manage_feishu_knowledge", label: "生成或执行飞书知识变更" }],
  coding: [...commonTools, { value: "run_coding_task", label: "交给 Codex 执行代码任务" }],
  design: [...commonTools, { value: "generate_image", label: "生成图片" }, { value: "edit_image", label: "编辑图片" }],
  client: [...commonTools, { value: "manage_feishu_knowledge", label: "生成或执行飞书知识变更" }],
  procurement: [
    ...commonTools,
    { value: "search_1688_products", label: "1688 找品" },
    { value: "get_procurement_search_archive", label: "读取历史找品结果" },
    { value: "save_procurement_candidates", label: "保存采购候选" },
    { value: "get_procurement_inquiry_context", label: "读取厂家询价上下文" },
    { value: "send_procurement_follow_up", label: "向厂家发送后续询价" },
  ],
  marketing: [...commonTools, { value: "manage_feishu_knowledge", label: "生成或执行飞书知识变更" }],
};

export function validateAgentSkillTools(agentType: ModelAgentType, values: unknown) {
  if (!Array.isArray(values) || values.length > 20 || values.some((value) => typeof value !== "string")) return null;
  const allowed = new Set(agentSkillToolOptions[agentType].map((item) => item.value));
  const unique = [...new Set(values as string[])];
  return unique.every((value) => allowed.has(value)) ? unique : null;
}
