export type AgentId = "planner" | "coder" | "designer" | "client" | "buyer" | "marketing";

export type ProjectSection = "workspace" | "files" | "activity" | "repository";

export type AgentWorkStatus = "idle" | "working" | "completed" | "error";

export type DrawerId = "brain" | "files" | "knowledgeSearch" | "companyKnowledge" | "repository" | "collaboration" | "activity" | null;

export type ChatMessage = {
  id: string;
  role: "user" | "agent" | "task";
  body: string;
  durationMs?: number | null;
  visualSources?: Array<{
    kind: "generation" | "project_file" | "feishu_drive" | "design_asset";
    id: string;
    name: string;
    path?: string | null;
    previewUrl?: string | null;
  }>;
};

export type AgentAttachment = {
  id: string;
  file: File;
  saveToFeishu: boolean;
  materialTarget?: "knowledge" | "drive";
  materialScopeId?: string;
  materialParentToken?: string | null;
  materialDestinationLabel?: string;
};

export type AgentSendResult = {
  sent: boolean;
  attachmentsAccepted: boolean;
  reply?: string;
};

export type AgentTask = {
  id: string;
  from: AgentId;
  title: string;
  content: string;
  briefType?: "technical" | "visual";
};

export type ActivityItem = {
  time: string;
  text: string;
};

export type Project = {
  id: string;
  name: string;
  short: string;
  description: string;
  status: string;
  kind: "standard" | "workspace_materials";
  role: "project_lead" | "member";
  currentStage: string;
  summary: string;
  currentPlanSummary: string;
  focus: string;
  module: string;
  knowledge: string[];
};
