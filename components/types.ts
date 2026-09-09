export type AgentId = "planner" | "coder" | "designer";

export type DrawerId = "brain" | "files" | "activity" | null;

export type ChatMessage = {
  id: string;
  role: "user" | "agent";
  body: string;
};

export type AgentTask = {
  id: string;
  from: AgentId;
  title: string;
  content: string;
};

export type ActivityItem = {
  time: string;
  text: string;
};

export type Project = {
  id: string;
  name: string;
  short: string;
  focus: string;
  module: string;
  plannerMessages: ChatMessage[];
  knowledge: string[];
  files: { name: string; meta: string }[];
};
