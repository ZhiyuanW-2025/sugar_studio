import type { ModelAgentType } from "../model-config/catalog";

export type AgentDefinition = {
  type: ModelAgentType;
  slug: "xiaohua" | "niuniu" | "xiaoxiong" | "xiaoxue" | "lafu" | "doudou";
  name: string;
  roleTitle: string;
  initials: string;
  description: string;
  knowledge: { label: string; status: "enabled" | "disabled" }[];
  tools: { label: string; status: "enabled" | "disabled" }[];
};

export const agentDefinitions: AgentDefinition[] = [
  {
    type: "planning",
    slug: "xiaohua",
    name: "制作人小花",
    roleTitle: "制作人 · 主 Agent",
    initials: "花",
    description: "负责理解目标、推进项目、管理知识并协调专业 Agent。",
    knowledge: [
      { label: "当前项目知识", status: "enabled" },
      { label: "当前项目材料", status: "enabled" },
      { label: "工作室长期知识", status: "enabled" },
      { label: "外部公开资料", status: "disabled" },
    ],
    tools: [
      { label: "get_project_context", status: "enabled" },
      { label: "search_project_knowledge", status: "enabled" },
      { label: "飞书知识变更草稿", status: "enabled" },
      { label: "Web Search", status: "disabled" },
      { label: "创建策划草稿", status: "disabled" },
      { label: "创建交接任务", status: "disabled" },
    ],
  },
  {
    type: "coding",
    slug: "niuniu",
    name: "工程师牛牛",
    roleTitle: "工程师",
    initials: "牛",
    description: "负责理解技术任务、拆解实现路径并识别开发风险。",
    knowledge: [
      { label: "当前项目知识", status: "enabled" },
      { label: "当前项目材料", status: "enabled" },
      { label: "工作室长期知识", status: "enabled" },
      { label: "外部公开资料", status: "disabled" },
    ],
    tools: [
      { label: "get_project_context", status: "enabled" },
      { label: "search_project_knowledge", status: "enabled" },
      { label: "飞书知识发布", status: "enabled" },
      { label: "读取执行任务", status: "enabled" },
      { label: "run_coding_task · Codex", status: "enabled" },
    ],
  },
  {
    type: "design",
    slug: "xiaoxiong",
    name: "艺术家小熊",
    roleTitle: "艺术家",
    initials: "熊",
    description: "负责理解视觉任务、提出视觉方向并整理执行方案。",
    knowledge: [
      { label: "当前项目知识", status: "enabled" },
      { label: "当前项目材料", status: "enabled" },
      { label: "工作室长期知识", status: "enabled" },
      { label: "外部公开资料", status: "disabled" },
    ],
    tools: [
      { label: "get_project_context", status: "enabled" },
      { label: "search_project_knowledge", status: "enabled" },
      { label: "飞书知识变更草稿", status: "enabled" },
      { label: "读取视觉任务", status: "enabled" },
      { label: "generate_image", status: "enabled" },
      { label: "edit_image", status: "enabled" },
    ],
  },
  {
    type: "client",
    slug: "xiaoxue",
    name: "客户伙伴小雪",
    roleTitle: "客户交付",
    initials: "雪",
    description: "负责把已确认项目内容整理成 B 端客户材料与沟通草稿。",
    knowledge: [
      { label: "当前项目知识", status: "enabled" },
      { label: "当前项目材料", status: "enabled" },
      { label: "客户与合同资料", status: "enabled" },
      { label: "工作室材料模板", status: "enabled" },
    ],
    tools: [
      { label: "get_project_context", status: "enabled" },
      { label: "search_project_knowledge", status: "enabled" },
      { label: "飞书知识变更草稿", status: "enabled" },
      { label: "材料结构化草稿", status: "enabled" },
      { label: "DOCX / PDF / PPT 导出", status: "disabled" },
      { label: "邮件 / 企业微信发送", status: "disabled" },
    ],
  },
  {
    type: "procurement",
    slug: "lafu",
    name: "金牌买手拉夫",
    roleTitle: "专业采购",
    initials: "拉",
    description: "负责 1688 找品、供应商筛选、采购比较与候选整理。",
    knowledge: [
      { label: "当前项目知识", status: "enabled" },
      { label: "当前项目材料", status: "enabled" },
      { label: "工作室长期知识", status: "enabled" },
      { label: "1688 实时找品结果", status: "enabled" },
    ],
    tools: [
      { label: "get_project_context", status: "enabled" },
      { label: "search_project_knowledge", status: "enabled" },
      { label: "search_1688_products", status: "enabled" },
      { label: "save_procurement_candidates", status: "enabled" },
      { label: "get_procurement_search_archive", status: "enabled" },
      { label: "get_procurement_inquiry_context", status: "enabled" },
      { label: "send_procurement_follow_up", status: "enabled" },
      { label: "自动下单 / 付款", status: "disabled" },
    ],
  },
  {
    type: "marketing",
    slug: "doudou",
    name: "宣传委员豆豆",
    roleTitle: "营销内容",
    initials: "豆",
    description: "负责把项目成果转化为小红书与微信公众号营销图文。",
    knowledge: [
      { label: "当前项目知识", status: "enabled" },
      { label: "当前项目材料", status: "enabled" },
      { label: "工作室长期知识", status: "enabled" },
      { label: "平台实时数据", status: "disabled" },
    ],
    tools: [
      { label: "get_project_context", status: "enabled" },
      { label: "search_project_knowledge", status: "enabled" },
      { label: "飞书知识变更草稿", status: "enabled" },
      { label: "营销内容草稿库", status: "enabled" },
      { label: "交给艺术家小熊配图", status: "enabled" },
      { label: "小红书 / 公众号直接发布", status: "disabled" },
    ],
  },
];

export function getAgentDefinition(value: string) {
  return agentDefinitions.find((agent) => agent.type === value || agent.slug === value);
}
