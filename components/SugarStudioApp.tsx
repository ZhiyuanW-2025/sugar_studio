"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentPicker } from "./AgentPicker";
import { AgentWorkspace } from "./AgentWorkspace";
import { HandoffModal } from "./HandoffModal";
import { codeTask, designTask, projects } from "./mockData";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import type { ActivityItem, AgentId, AgentTask, ChatMessage, DrawerId } from "./types";
import { WorkspaceDrawer } from "./WorkspaceDrawer";

const initialActivity: ActivityItem[] = [
  { time: "12:41", text: "你保存了 Moon Moi 最新方案" },
  { time: "12:43", text: "策划 Agent 向代码 Agent 发送任务" },
  { time: "12:44", text: "代码 Agent 接收任务" },
  { time: "12:51", text: "你添加了美工 Agent" },
];

const emptyMessages = (): Record<AgentId, ChatMessage[]> => ({
  planner: [],
  coder: [],
  designer: [],
});

const getTime = () =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

export function SugarStudioApp() {
  const [projectId, setProjectId] = useState(projects[0].id);
  const [openAgents, setOpenAgents] = useState<AgentId[]>(["planner", "coder"]);
  const [messages, setMessages] = useState<Record<AgentId, ChatMessage[]>>({
    ...emptyMessages(),
    planner: projects[0].plannerMessages,
  });
  const [tasks, setTasks] = useState<Record<"coder" | "designer", AgentTask[]>>({ coder: [], designer: [] });
  const [saved, setSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [handoffTarget, setHandoffTarget] = useState<"coder" | "designer" | null>(null);
  const [drawer, setDrawer] = useState<DrawerId>(null);
  const [activity, setActivity] = useState<ActivityItem[]>(initialActivity);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const project = useMemo(
    () => projects.find((item) => item.id === projectId) ?? projects[0],
    [projectId],
  );

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      replyTimers.current.forEach(clearTimeout);
    };
  }, []);

  const showNotice = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const addActivity = (text: string) => {
    setActivity((items) => [{ time: getTime(), text }, ...items]);
  };

  const handleProjectChange = (id: string) => {
    const next = projects.find((item) => item.id === id);
    if (!next || next.id === projectId) return;
    setProjectId(id);
    setOpenAgents(["planner", "coder"]);
    setMessages({ ...emptyMessages(), planner: next.plannerMessages });
    setTasks({ coder: [], designer: [] });
    setSaved(false);
    setDrawer(null);
    setActivity([{ time: getTime(), text: `你切换到项目「${next.name}」` }]);
    showNotice(`已切换到「${next.name}」`);
  };

  const handleAddAgent = (agentId: AgentId) => {
    if (!openAgents.includes(agentId)) {
      setOpenAgents((agents) => [...agents, agentId]);
      addActivity(`你添加了${agentId === "planner" ? "策划" : agentId === "coder" ? "代码" : "美工"} Agent`);
      showNotice(`${agentId === "planner" ? "策划" : agentId === "coder" ? "代码" : "美工"} Agent 已加入工作台`);
    }
    setPickerOpen(false);
  };

  const handleCloseAgent = (agentId: AgentId) => {
    setOpenAgents((agents) => agents.filter((id) => id !== agentId));
    addActivity(`你关闭了${agentId === "planner" ? "策划" : agentId === "coder" ? "代码" : "美工"} Agent 面板`);
  };

  const handleSave = () => {
    if (saved) {
      showNotice("这项更新已经是当前方案");
      return;
    }
    setSaved(true);
    addActivity(`你保存了 ${project.module} 最新方案`);
    showNotice("已保存为当前方案，其他 Agent 现在可以读取这项更新");
  };

  const handoffContent = handoffTarget === "designer" ? designTask : codeTask(project.name);

  const confirmHandoff = (content: string) => {
    if (!handoffTarget) return;
    const target = handoffTarget;
    const firstLine = content.split("\n")[0]?.replace(/^任务[：:]\s*/, "") || "来自策划 Agent 的新任务";
    const task: AgentTask = {
      id: `${target}-${Date.now()}`,
      from: "planner",
      title: firstLine,
      content,
    };
    setTasks((current) => ({ ...current, [target]: [...current[target], task] }));
    if (!openAgents.includes(target)) {
      setOpenAgents((agents) => [...agents, target]);
      addActivity(`你添加了${target === "coder" ? "代码" : "美工"} Agent`);
    }
    addActivity(`策划 Agent 向${target === "coder" ? "代码" : "美工"} Agent 发送任务`);
    addActivity(`${target === "coder" ? "代码" : "美工"} Agent 接收任务`);
    setHandoffTarget(null);
    showNotice(`任务已发送给${target === "coder" ? "代码" : "美工"} Agent`);
  };

  const handleSendMessage = (agentId: AgentId, body: string) => {
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      body,
    };
    setMessages((current) => ({ ...current, [agentId]: [...current[agentId], userMessage] }));

    const timer = setTimeout(() => {
      const agentName = agentId === "planner" ? "策划" : agentId === "coder" ? "代码" : "美工";
      const reply: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: "agent",
        body: `收到，我会把这条信息加入当前${agentName}上下文。当前 Demo 使用前端状态模拟，真正的 Agent 对话将在后续版本开放。`,
      };
      setMessages((current) => ({ ...current, [agentId]: [...current[agentId], reply] }));
    }, 500);
    replyTimers.current.push(timer);
  };

  return (
    <div className="flex h-screen min-h-[680px] w-full overflow-hidden bg-[#f7f7f4]">
      <Sidebar activeDrawer={drawer} onOpenDrawer={setDrawer} onNotice={showNotice} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          projectId={projectId}
          openAgentCount={openAgents.length}
          onProjectChange={handleProjectChange}
          onAddAgent={() => setPickerOpen(true)}
          onNotice={showNotice}
        />
        <AgentWorkspace
          project={project}
          openAgents={openAgents}
          messages={messages}
          tasks={tasks}
          saved={saved}
          onSave={handleSave}
          onHandoff={setHandoffTarget}
          onCloseAgent={handleCloseAgent}
          onSendMessage={handleSendMessage}
          onAddAgent={() => setPickerOpen(true)}
        />
      </div>

      {pickerOpen && (
        <AgentPicker openAgents={openAgents} onAdd={handleAddAgent} onClose={() => setPickerOpen(false)} />
      )}
      {handoffTarget && (
        <HandoffModal
          target={handoffTarget}
          initialContent={handoffContent}
          onCancel={() => setHandoffTarget(null)}
          onConfirm={confirmHandoff}
        />
      )}
      {drawer && (
        <WorkspaceDrawer
          drawer={drawer}
          project={project}
          activity={activity}
          onClose={() => setDrawer(null)}
          onNotice={showNotice}
        />
      )}

      {toast && (
        <div role="status" className="panel-in fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-[8px] border border-[#d8ded9] bg-[#243f34] px-3.5 py-2.5 text-[11px] font-medium text-white shadow-[0_12px_34px_rgba(20,40,30,0.2)]">
          <span className="mr-2 text-[#aed0be]">✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}
