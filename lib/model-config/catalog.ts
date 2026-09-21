export const providerOptions = [
  {
    value: "openai",
    label: "OpenAI",
    models: [
      { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    ],
  },
] as const;

export type ModelProvider = (typeof providerOptions)[number]["value"];
export const modelProviders = providerOptions.map((provider) => provider.value) as ModelProvider[];

export const agentOptions = [
  { value: "planning", label: "制作人小花" },
  { value: "coding", label: "工程师牛牛" },
  { value: "design", label: "艺术家小熊" },
  { value: "client", label: "客户伙伴小雪" },
  { value: "procurement", label: "金牌买手拉夫" },
  { value: "marketing", label: "宣传委员豆豆" },
] as const;

export type ModelAgentType = (typeof agentOptions)[number]["value"];
export const modelAgentTypes = agentOptions.map((agent) => agent.value) as ModelAgentType[];

export type ModelConfigSummary = {
  id: string;
  provider: ModelProvider;
  model: string;
  isDefault: boolean;
  apiKeyMasked: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentModelPreference = {
  agentType: ModelAgentType;
  modelConfigId: string;
};
