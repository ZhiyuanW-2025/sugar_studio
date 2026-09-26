export const agentTestKnowledgeSources = [
  { value: "project_context", label: "项目正式概况", description: "当前阶段、方案摘要和项目状态" },
  { value: "project_knowledge", label: "项目与公司知识", description: "项目材料、飞书知识库与媒体索引" },
  { value: "agent_general_knowledge", label: "Agent 通用知识", description: "这个 Agent 的方法、规范与模板" },
] as const;

export type AgentTestKnowledgeSource = (typeof agentTestKnowledgeSources)[number]["value"];
export const maxAgentTestVersions = 6;

export type AgentTestVersion = {
  id: string;
  name: string;
  position: number;
  modelConfigId: string | null;
  promptOverride: string | null;
  knowledgeSources: AgentTestKnowledgeSource[];
  skillSlugs: string[];
};

export type AgentTestResult = {
  id: string;
  versionId: string | null;
  versionName: string;
  status: "completed" | "failed";
  reply: string | null;
  error: string | null;
  toolCalls: string[];
  loadedSkills: string[];
  modelProvider: string | null;
  model: string | null;
  promptSource: string | null;
  promptVersion: number | null;
  durationMs: number | null;
  traceId: string | null;
  score: number | null;
  scoredAt: string | null;
  configSnapshot: {
    knowledgeSources?: AgentTestKnowledgeSource[];
    skillSlugs?: string[];
    modelConfigId?: string | null;
    promptOverride?: string | null;
  };
};

export type AgentTestRun = {
  id: string;
  status: "running" | "completed" | "failed";
  prompt: string;
  startedAt: string;
  completedAt: string | null;
  results: AgentTestResult[];
};

export type AgentTestCase = {
  id: string;
  projectId: string;
  projectName: string;
  agentType: string;
  title: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  versions: AgentTestVersion[];
  latestRun: AgentTestRun | null;
};

export type AgentTestCatalog = {
  models: { id: string; provider: string; model: string; isDefault: boolean }[];
  skills: { slug: string; name: string; version: number; description: string }[];
  prompt: { instructions: string; source: "database" | "fallback"; version: number | null };
};
