import type { ModelAgentType } from "../model-config/catalog";

export type AgentDefinition = {
  type: ModelAgentType;
  slug: "xiaohua" | "niuniu" | "xiaoxiong" | "xiaoxue" | "lafu" | "doudou";
  name: string;
  roleTitle: string;
  initials: string;
  description: string;
  knowledge: { label: string; status: "enabled" | "disabled" }[];
  tools: {
    label: string;
    slug?: string;
    status: "enabled" | "disabled";
    description?: string;
    implementation?: string;
    inputSchema?: Record<string, unknown>;
  }[];
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
    roleTitle: "项目宣传与小红书内容",
    initials: "豆",
    description: "负责项目级小红书内容规划、具体作品创作与图片指令整理。",
    knowledge: [
      { label: "当前项目知识", status: "enabled" },
      { label: "当前项目材料", status: "enabled" },
      { label: "工作室长期知识", status: "enabled" },
      { label: "平台实时数据", status: "disabled" },
    ],
    tools: [
      {
        label: "读取当前项目正式概况",
        slug: "get_project_context",
        status: "enabled",
        description: "读取当前请求绑定项目的名称、描述、阶段、摘要和正式方案概况；不能选择或读取其他项目。",
        implementation: "服务端 OpenAI Agents SDK function tool。user_id 与 project_id 由当前登录请求注入，执行前检查项目成员关系，再读取 projects 与 project_snapshots。",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        label: "检索项目与公司知识",
        slug: "search_project_knowledge",
        status: "enabled",
        description: "检索当前项目材料、已索引的飞书内容、飞书云盘素材摘要及公司共享知识，并返回文件名、页码和引用片段。",
        implementation: "服务端 OpenAI Agents SDK function tool。检索范围被当前项目成员权限和 scope 限制；返回资料属于不可信参考内容，不能覆盖系统指令。",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "问题或检索关键词，1–1000 字" },
            scope: { type: "string", enum: ["all", "project", "company"], default: "all" },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        label: "检索豆豆通用工作知识",
        slug: "search_agent_general_knowledge",
        status: "enabled",
        description: "只检索豆豆自己连接的飞书通用知识库，例如小红书基础方法、选题策略、标题钩子、写作风格和视觉叙事规范。",
        implementation: "服务端 OpenAI Agents SDK function tool。Agent 类型由服务端绑定，使用独立向量检索函数，只读取宣传委员豆豆关联的飞书 scope；不会读取小花、牛牛、小熊等其他 Agent 的通用知识。",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "要检索的专业方法、规范或关键词，1–1000 字" } },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        label: "按需加载豆豆 Skill",
        slug: "load_agent_skill",
        status: "enabled",
        description: "根据任务只加载三条已启用 Skill 中匹配的一条；Skill 只能收窄工作方法和工具范围，不能扩大权限。",
        implementation: "服务端 OpenAI Agents SDK function tool。可加载 xhs-content-planning、xhs-post-creation、xhs-image-prompt；内容来自当前 active Skill Version。",
        inputSchema: {
          type: "object",
          properties: { slug: { type: "string", enum: ["xhs-content-planning", "xhs-post-creation", "xhs-image-prompt"] } },
          required: ["slug"],
          additionalProperties: false,
        },
      },
      {
        label: "更新当前宣传作品",
        slug: "update_marketing_content",
        status: "enabled",
        description: "仅在用户选中右侧某篇宣传作品时可用，用于局部或整体更新这篇作品的标题、正文、封面文案、标签和图片建议。",
        implementation: "服务端 OpenAI Agents SDK function tool。marketing_content_id、project_id 与 user_id 均由请求上下文绑定，模型不能指定其他作品；更新受项目成员 RLS 保护。",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", maxLength: 240 },
            content: { type: "string", maxLength: 100000 },
            cover_copy: { type: "string", maxLength: 1000 },
            tags: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 30 },
            image_plan: { type: "string", maxLength: 20000 },
            change_summary: { type: "string", description: "给用户看的本轮修改摘要", maxLength: 1000 },
          },
          required: ["change_summary"],
          additionalProperties: false,
        },
      },
      {
        label: "管理飞书知识内容",
        slug: "manage_feishu_knowledge",
        status: "enabled",
        description: "按用户明确要求创建、追加或修改飞书文档，或把知识库中的原文件上传至飞书；普通宣传创作不会自动调用。",
        implementation: "服务端 OpenAI Agents SDK function tool。明确授权可直接执行；预览或存在歧义时生成临时确认操作。所有执行继续经过项目权限、飞书连接和文档范围校验。",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["create_document", "append_content", "replace_text", "upload_file"] },
            document_title: { type: "string" },
            change_summary: { type: "string" },
            content: { type: ["string", "null"] },
            old_text: { type: ["string", "null"] },
            new_text: { type: ["string", "null"] },
            source_document_id: { type: ["string", "null"] },
            execution_mode: { type: "string", enum: ["execute_now", "request_confirmation"] },
          },
          required: ["action", "document_title", "change_summary", "execution_mode"],
          additionalProperties: false,
        },
      },
      {
        label: "小红书直接发布",
        slug: "publish_xiaohongshu",
        status: "disabled",
        description: "第一版不登录小红书、不自动发布、不投流，也不代替用户回复评论。",
        implementation: "尚未接入任何平台账号或发布 API，仅作为未来能力占位。",
        inputSchema: {},
      },
    ],
  },
];

export function getAgentDefinition(value: string) {
  return agentDefinitions.find((agent) => agent.type === value || agent.slug === value);
}
