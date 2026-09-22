import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAgentDefinition, type AgentDefinition } from "./catalog";

export type AgentToolConfig = {
  id: string | null;
  slug: string;
  name: string;
  description: string;
  implementation: string;
  inputSchema: Record<string, unknown>;
  status: "enabled" | "disabled";
  isBuiltin: boolean;
};

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "custom_tool";
}

function builtInTools(agent: AgentDefinition): AgentToolConfig[] {
  return agent.tools.map((tool) => {
    const slug = slugify(tool.label.split(" · ")[0]);
    return {
      id: null,
      slug,
      name: tool.label,
      description: tool.status === "enabled" ? `为${agent.name}提供“${tool.label}”能力。` : `该能力目前未接入${agent.name}。`,
      implementation: tool.status === "enabled"
        ? `服务端工具：${slug}。实际执行由 Sugar Agent 服务端代码负责；此处可编辑工具说明、输入结构和使用边界。`
        : "当前尚未接入可执行实现，仅作为预留工具定义。",
      inputSchema: {},
      status: tool.status === "enabled" ? "enabled" : "disabled",
      isBuiltin: true,
    };
  });
}

export async function resolveAgentToolConfigs(supabase: SupabaseClient, agent: AgentDefinition) {
  const { data: agentRow } = await supabase.from("agents").select("id").eq("agent_type", agent.type).maybeSingle();
  const { data } = agentRow ? await supabase.from("agent_tool_configs")
    .select("id,slug,name,description,implementation,input_schema,status")
    .eq("agent_id", agentRow.id)
    .order("slug") : { data: null };
  const overrides = new Map((data ?? []).map((tool) => [tool.slug, tool]));
  const builtins = builtInTools(agent).map((tool) => {
    const override = overrides.get(tool.slug);
    if (!override) return tool;
    return {
      ...tool,
      id: override.id,
      name: override.name,
      description: override.description,
      implementation: override.implementation,
      inputSchema: (override.input_schema as Record<string, unknown>) ?? {},
      status: override.status as "enabled" | "disabled",
    };
  });
  const knownSlugs = new Set(builtins.map((tool) => tool.slug));
  const custom = (data ?? []).filter((tool) => !knownSlugs.has(tool.slug)).map((tool) => ({
    id: tool.id, slug: tool.slug, name: tool.name, description: tool.description,
    implementation: tool.implementation, inputSchema: (tool.input_schema as Record<string, unknown>) ?? {},
    status: tool.status as "enabled" | "disabled", isBuiltin: false,
  }));
  return [...builtins, ...custom];
}

export async function resolveAgentToolConfigsForType(supabase: SupabaseClient, agentType: string) {
  const agent = getAgentDefinition(agentType);
  return agent ? resolveAgentToolConfigs(supabase, agent) : [];
}

export function buildAgentToolInstructions(tools: AgentToolConfig[]) {
  if (!tools.length) return "";
  return `\n\n以下是该 Agent 当前可见的工具说明。工具是否真正可执行由服务端代码控制；不要声称拥有列表之外的权限，也不要把工具说明当作项目事实：\n${tools.map((tool) => {
    const status = tool.status === "enabled" ? "可用" : "停用";
    return `## ${tool.name}（${tool.slug}，${status}）\n用途与边界：${tool.description}\n构成说明：${tool.implementation}\n输入结构：${JSON.stringify(tool.inputSchema)}`;
  }).join("\n\n")}`;
}

export async function resolveActiveAgentGeneralKnowledge(supabase: SupabaseClient, agentType: string) {
  const { data: agent } = await supabase.from("agents").select("id,general_feishu_scope_id").eq("agent_type", agentType).maybeSingle();
  if (!agent) return [] as Array<{ title: string; content: string }>;
  const { data } = await supabase.from("agent_general_knowledge")
    .select("title,content").eq("agent_id", agent.id).eq("status", "active").order("updated_at", { ascending: false });
  const items = [...(data ?? [])];
  if (agent.general_feishu_scope_id) {
    const { data: scope } = await supabase.from("feishu_sync_scopes")
      .select("display_name,source_url,last_sync_status")
      .eq("id", agent.general_feishu_scope_id).eq("enabled", true).maybeSingle();
    if (scope) items.push({
      title: `已连接的飞书通用知识库：${scope.display_name}`,
      content: `这是该 Agent 的全局工作知识来源，当前状态为${scope.last_sync_status === "ready" ? "已同步" : "待同步或同步中"}。需要查找其中的规范、模板和工作方法时，使用 search_project_knowledge 检索公司知识；不要把飞书地址或同步状态当作项目事实。来源地址：${scope.source_url}`,
    });
  }
  return items;
}

export function buildAgentGeneralKnowledgeInstructions(items: Array<{ title: string; content: string }>) {
  if (!items.length) return "";
  return `\n\n以下是该 Agent 的通用工作知识。它们定义工作方法，不是当前项目事实；项目事实必须以项目上下文和项目知识为准：\n${items.map((item) => `## ${item.title}\n${item.content}`).join("\n\n")}`;
}
