"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "../lib/supabase/client";
import type { HandoffBrief } from "../lib/handoffs/briefs";
import type { CodingRunView } from "../lib/coding-runs/types";
import { AgentPicker } from "./AgentPicker";
import { AgentWorkspace } from "./AgentWorkspace";
import { HandoffModal } from "./HandoffModal";
import { agentMeta } from "./mockData";
import { PlanSaveModal, type PlanSavePreview } from "./PlanSaveModal";
import { ProjectSettingsModal } from "./ProjectSettingsModal";
import { ProjectSectionView } from "./ProjectSectionView";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import type { AgentAttachment, AgentSendResult, ActivityItem, AgentId, AgentTask, ChatMessage, DrawerId, Project, ProjectSection } from "./types";
import { WorkspaceDrawer } from "./WorkspaceDrawer";
import { QuickHandoffModal } from "./QuickHandoffModal";
import { UnarchivedFilesNotice } from "./UnarchivedFilesNotice";

const initialActivity: ActivityItem[] = [
  { time: "12:41", text: "你保存了 Moon Moi 最新方案" },
  { time: "12:43", text: "制作人小花向工程师牛牛发送任务" },
  { time: "12:44", text: "工程师牛牛接收任务" },
  { time: "12:51", text: "你添加了艺术家小熊" },
];

const emptyMessages = (): Record<AgentId, ChatMessage[]> => ({
  planner: [],
  coder: [],
  designer: [],
  client: [],
  buyer: [],
  marketing: [],
});

const getTime = () =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

type SugarStudioAppProps = {
  currentUser: {
    displayName: string;
    email: string;
    avatarUrl: string | null;
  };
  initialProjects: Project[];
  hasModelConfig: boolean;
};

type AgentApiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  durationMs?: number | null;
};

const visualSourcesPattern = /\n?\[\[sugar_visual_sources:([^\]]+)\]\]/;
const toChatMessage = (message: AgentApiMessage): ChatMessage => {
  const marker = message.content.match(visualSourcesPattern);
  let visualSources: ChatMessage["visualSources"];
  if (marker?.[1]) {
    try { visualSources = JSON.parse(decodeURIComponent(marker[1])) as ChatMessage["visualSources"]; }
    catch { visualSources = undefined; }
  }
  return {
    id: message.id,
    role: message.role === "user" ? "user" : message.role === "system" ? "task" : "agent",
    body: message.content.replace(visualSourcesPattern, "").trim(),
    durationMs: message.durationMs,
    visualSources,
  };
};

const agentApiType: Record<AgentId, "planning" | "coding" | "design" | "client" | "procurement" | "marketing"> = {
  planner: "planning",
  coder: "coding",
  designer: "design",
  client: "client",
  buyer: "procurement",
  marketing: "marketing",
};

type HandoffDraft = {
  taskId: string;
  target: "coder" | "designer";
  brief: HandoffBrief;
};

type IngestedAttachment = {
  fileId?: string;
  fileName: string;
  scope: "feishu" | "unarchived";
  archiveProjectId: string;
  archiveProjectName: string;
  indexStatus: "ready" | "pending";
  documentId?: string;
  indexError?: string;
};

async function ingestKnowledgeAttachments(
  sourceProjectId: string,
  attachments: AgentAttachment[],
  userDescription: string,
  onProgress: (message: string) => void,
): Promise<IngestedAttachment[]> {
  const uploaded: IngestedAttachment[] = [];
  try {
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index];
      onProgress(`正在上传知识文件 ${index + 1}/${attachments.length}：${attachment.file.name}`);
      const form = new FormData();
      form.set("file", attachment.file);
      if (attachment.saveToFeishu) {
        form.set("projectId", sourceProjectId);
        if (attachment.materialScopeId) form.set("scopeId", attachment.materialScopeId);
        if (attachment.materialParentToken) form.set("parentToken", attachment.materialParentToken);
      } else form.set("sourceProjectId", sourceProjectId);
      if (userDescription) form.set("userDescription", userDescription);
      const response = await fetch(attachment.saveToFeishu ? "/api/projects/materials/upload" : "/api/knowledge/unarchived-files", { method: "POST", body: form });
      const payload = await response.json().catch(() => null) as {
        uploaded?: boolean;
        file?: { id?: string; file_name?: string };
        fileName?: string;
        nodeToken?: string | null;
        taskId?: string | null;
        knowledge?: { fileId?: string; documentId?: string; status?: string } | null;
        synced?: { documentId?: string | null; status?: string } | null;
        error?: string;
      } | null;
      if (!response.ok || !payload?.uploaded) {
        throw new Error(payload?.error || `「${attachment.file.name}」上传失败。`);
      }
      uploaded.push({
        fileId: payload.file?.id || payload.knowledge?.fileId,
        fileName: payload.file?.file_name || payload.fileName || attachment.file.name,
        scope: attachment.saveToFeishu ? "feishu" : "unarchived",
        archiveProjectId: sourceProjectId,
        archiveProjectName: attachment.saveToFeishu ? attachment.materialDestinationLabel || "飞书" : "仅本次对话",
        indexStatus: attachment.materialTarget === "drive" || payload.knowledge?.status === "ready" || payload.synced?.status === "ready" ? "ready" : "pending",
        documentId: payload.knowledge?.documentId || payload.synced?.documentId || undefined,
      });
      if (attachment.saveToFeishu) window.dispatchEvent(new Event("sugar:materials-changed"));
    }
  } catch (error) {
    await Promise.allSettled(uploaded.filter((item) => item.scope === "unarchived" && item.fileId).map((item) => fetch(
      `/api/knowledge/unarchived-files/${item.fileId}`,
      { method: "DELETE" },
    )));
    throw error;
  }

  for (let index = 0; index < uploaded.length; index += 1) {
    const item = uploaded[index];
    if (item.indexStatus === "ready" || !item.documentId) continue;
    onProgress(`正在解析并建立索引 ${index + 1}/${uploaded.length}：${item.fileName}`);
    const response = await fetch(`/api/knowledge/documents/${item.documentId}/index`, { method: "POST" });
    const payload = await response.json().catch(() => null) as { status?: string; error?: string } | null;
    item.indexStatus = response.ok && payload?.status === "ready" ? "ready" : "pending";
    item.indexError = response.ok ? undefined : payload?.error || "索引将在后台继续处理。";
  }
  return uploaded;
}

export function SugarStudioApp({ currentUser, initialProjects, hasModelConfig }: SugarStudioAppProps) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [projectId, setProjectId] = useState(initialProjects[0].id);
  const [openAgents, setOpenAgents] = useState<AgentId[]>(["planner"]);
  const [activeAgent, setActiveAgent] = useState<AgentId | null>("planner");
  const [hydratedAgentTabsFor, setHydratedAgentTabsFor] = useState<string>();
  const [completedAgents, setCompletedAgents] = useState<Partial<Record<AgentId, boolean>>>({});
  const [section, setSection] = useState<ProjectSection>("workspace");
  const [messages, setMessages] = useState<Record<AgentId, ChatMessage[]>>(emptyMessages);
  const [tasks, setTasks] = useState<Record<AgentId, AgentTask[]>>({
    planner: [],
    coder: [],
    designer: [],
    client: [],
    buyer: [],
    marketing: [],
  });
  const [saved, setSaved] = useState(false);
  const [planSavePreview, setPlanSavePreview] = useState<PlanSavePreview | null>(null);
  const [isPreparingPlanSave, setIsPreparingPlanSave] = useState(false);
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [planSaveError, setPlanSaveError] = useState<string>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [handoffDraft, setHandoffDraft] = useState<HandoffDraft | null>(null);
  const [preparingHandoff, setPreparingHandoff] = useState<"coder" | "designer" | null>(null);
  const [isSendingHandoff, setIsSendingHandoff] = useState(false);
  const [handoffError, setHandoffError] = useState<string>();
  const [drawer, setDrawer] = useState<DrawerId>(null);
  const [activity, setActivity] = useState<ActivityItem[]>(initialActivity);
  const [toast, setToast] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [generatingAgents, setGeneratingAgents] = useState<Partial<Record<AgentId, boolean>>>({});
  const [agentErrors, setAgentErrors] = useState<Partial<Record<AgentId, string>>>({});
  const [agentProgress, setAgentProgress] = useState<Partial<Record<AgentId, string>>>({});
  const [agentStartedAt, setAgentStartedAt] = useState<Partial<Record<AgentId, number>>>({});
  const [loadingAgents, setLoadingAgents] = useState<Partial<Record<AgentId, boolean>>>({ planner: true });
  const [conversationIds, setConversationIds] = useState<Partial<Record<AgentId, string>>>({});
  const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>({});
  const [quickHandoff, setQuickHandoff] = useState<{ source: AgentId; target: AgentId; title: string; content: string } | null>(null);
  const [quickHandoffSending, setQuickHandoffSending] = useState(false);
  const [quickHandoffError, setQuickHandoffError] = useState<string>();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentRequestRefs = useRef<Partial<Record<AgentId, string>>>({});
  const activeAgentRef = useRef<AgentId | null>("planner");
  const sectionRef = useRef<ProjectSection>("workspace");

  const project = useMemo(
    () => projects.find((item) => item.id === projectId) ?? projects[0],
    [projectId, projects],
  );

  useEffect(() => {
    activeAgentRef.current = activeAgent;
  }, [activeAgent]);

  useEffect(() => {
    sectionRef.current = section;
  }, [section]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const loadAgentHistory = useCallback(async (agentId: AgentId, signal?: AbortSignal) => {
    setLoadingAgents((current) => ({ ...current, [agentId]: true }));
    setAgentErrors((current) => ({ ...current, [agentId]: undefined }));
    try {
      const response = await fetch(
        `/api/agents/${agentApiType[agentId]}/messages?projectId=${encodeURIComponent(project.id)}`,
        { cache: "no-store", signal },
      );
      const payload = (await response.json().catch(() => null)) as
        | { messages?: AgentApiMessage[]; conversationId?: string | null; error?: string }
        | null;
      if (!response.ok || !Array.isArray(payload?.messages)) {
        throw new Error(payload?.error || "暂时无法加载对话，请稍后重试。");
      }
      setMessages((current) => ({ ...current, [agentId]: payload.messages!.map(toChatMessage) }));
      if (payload.conversationId) setConversationIds((current) => ({ ...current, [agentId]: payload.conversationId! }));
    } catch (error) {
      if (!signal?.aborted) {
        setAgentErrors((current) => ({
          ...current,
          [agentId]: error instanceof Error ? error.message : "暂时无法加载对话，请稍后重试。",
        }));
      }
    } finally {
      if (!signal?.aborted) setLoadingAgents((current) => ({ ...current, [agentId]: false }));
    }
  }, [project.id]);

  useEffect(() => {
    const controller = new AbortController();
    const storageKey = `sugar-agent-tabs:${currentUser.email}:${project.id}`;
    let restoredAgents: AgentId[] = ["planner"];
    let restoredActive: AgentId | null = "planner";
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as { openAgents?: AgentId[]; activeAgent?: AgentId | null };
        const allowed: AgentId[] = ["planner", "coder", "designer", "client", "buyer", "marketing"];
        restoredAgents = Array.isArray(parsed.openAgents) ? parsed.openAgents.filter((id) => allowed.includes(id)) : restoredAgents;
        restoredActive = parsed.activeAgent && restoredAgents.includes(parsed.activeAgent) ? parsed.activeAgent : restoredAgents[0] ?? null;
      }
    } catch {
      // Invalid local UI state should never block the project workspace.
    }
    setOpenAgents(restoredAgents);
    setActiveAgent(restoredActive);
    activeAgentRef.current = restoredActive;
    setLoadingAgents(restoredActive ? { [restoredActive]: true } : {});
    setAgentErrors({});
    setHydratedAgentTabsFor(project.id);
    if (restoredActive) void loadAgentHistory(restoredActive, controller.signal);
    return () => controller.abort();
  }, [currentUser.email, loadAgentHistory, project.id]);

  useEffect(() => {
    if (hydratedAgentTabsFor !== project.id) return;
    window.localStorage.setItem(
      `sugar-agent-tabs:${currentUser.email}:${project.id}`,
      JSON.stringify({ openAgents, activeAgent }),
    );
  }, [activeAgent, currentUser.email, hydratedAgentTabsFor, openAgents, project.id]);

  const showNotice = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const addActivity = (text: string) => {
    setActivity((items) => [{ time: getTime(), text }, ...items]);
  };

  const handleAddAgent = (agentId: AgentId) => {
    if (!openAgents.includes(agentId)) {
      setOpenAgents((agents) => [...agents, agentId]);
      const name = agentMeta[agentId].name;
      addActivity(`你添加了${name}`);
      showNotice(`${name}已加入工作台`);
    }
    if (loadingAgents[agentId] === undefined) void loadAgentHistory(agentId);
    setActiveAgent(agentId);
    activeAgentRef.current = agentId;
    setCompletedAgents((current) => ({ ...current, [agentId]: false }));
    setSection("workspace");
    sectionRef.current = "workspace";
    setPickerOpen(false);
  };

  const handleCloseAgent = (agentId: AgentId) => {
    setOpenAgents((agents) => {
      const index = agents.indexOf(agentId);
      const remaining = agents.filter((id) => id !== agentId);
      if (activeAgentRef.current === agentId) {
        const next = remaining[Math.min(index, remaining.length - 1)] ?? null;
        setActiveAgent(next);
        activeAgentRef.current = next;
      }
      return remaining;
    });
    addActivity(`你关闭了${agentMeta[agentId].name}标签`);
  };

  const handleActivateAgent = (agentId: AgentId) => {
    if (!openAgents.includes(agentId)) {
      addActivity(`你打开了${agentMeta[agentId].name}`);
      showNotice(`${agentMeta[agentId].name}已打开`);
      setOpenAgents((agents) => [...agents, agentId]);
    }
    if (loadingAgents[agentId] === undefined) void loadAgentHistory(agentId);
    setActiveAgent(agentId);
    activeAgentRef.current = agentId;
    setCompletedAgents((current) => ({ ...current, [agentId]: false }));
    setSection("workspace");
    sectionRef.current = "workspace";
  };

  const handleSave = async () => {
    if (saved) {
      showNotice("这项更新已经是当前方案");
      return;
    }
    if (isPreparingPlanSave) return;
    setIsPreparingPlanSave(true);
    setPlanSaveError(undefined);
    try {
      const response = await fetch(
        `/api/projects/current-plan?projectId=${encodeURIComponent(project.id)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => null)) as
        | (PlanSavePreview & { error?: never })
        | { error?: string }
        | null;
      if (!response.ok || !payload || !("content" in payload)) {
        throw new Error(payload?.error || "暂时无法准备待保存方案。");
      }
      setPlanSavePreview(payload);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "暂时无法准备待保存方案");
    } finally {
      setIsPreparingPlanSave(false);
    }
  };

  const confirmPlanSave = async () => {
    if (!planSavePreview || isSavingPlan) return;
    setIsSavingPlan(true);
    setPlanSaveError(undefined);

    try {
      const response = await fetch("/api/projects/current-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          sourceThreadId: planSavePreview.sourceThreadId,
          content: planSavePreview.content,
          changeSummary: planSavePreview.changeSummary,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { saved?: boolean; error?: string }
        | null;
      if (!response.ok || !payload?.saved) {
        throw new Error(payload?.error || "暂时无法保存正式方案。");
      }

      setSaved(true);
      setPlanSavePreview(null);
      addActivity(`你保存了 ${project.module} 最新正式方案`);
      showNotice("已保存为当前方案，其他 Agent 现在可以读取最新方案");
    } catch (error) {
      setPlanSaveError(error instanceof Error ? error.message : "暂时无法保存正式方案。");
    } finally {
      setIsSavingPlan(false);
    }
  };

  const prepareHandoff = async (target: "coder" | "designer") => {
    if (preparingHandoff) return;
    setPreparingHandoff(target);
    setHandoffError(undefined);
    showNotice(`制作人小花正在整理给${target === "coder" ? "工程师牛牛" : "艺术家小熊"}的任务草稿`);
    try {
      const response = await fetch("/api/handoffs/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          targetAgent: target === "coder" ? "coding" : "design",
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { taskId?: string; brief?: HandoffBrief; error?: string }
        | null;
      if (!response.ok || !payload?.taskId || !payload.brief) {
        throw new Error(payload?.error || "暂时无法生成交接草稿。");
      }
      setHandoffDraft({ taskId: payload.taskId, target, brief: payload.brief });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "暂时无法生成交接草稿");
    } finally {
      setPreparingHandoff(null);
    }
  };

  const confirmHandoff = async (brief: HandoffBrief) => {
    if (!handoffDraft || isSendingHandoff) return;
    const target = handoffDraft.target;
    setIsSendingHandoff(true);
    setHandoffError(undefined);
    try {
      const response = await fetch(`/api/handoffs/${handoffDraft.taskId}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, brief }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { delivered?: boolean; task?: { title?: string; content?: string }; error?: string }
        | null;
      if (!response.ok || !payload?.delivered || !payload.task?.title || !payload.task.content) {
        throw new Error(payload?.error || "任务发送失败。");
      }

    const task: AgentTask = {
      id: handoffDraft.taskId,
      from: "planner",
      title: payload.task.title,
      content: payload.task.content,
    };
    setTasks((current) => ({ ...current, [target]: [...current[target], task] }));
    setCompletedAgents((current) => ({ ...current, [target]: true }));
    if (!openAgents.includes(target)) {
      setOpenAgents((agents) => [...agents, target]);
      addActivity(`你添加了${target === "coder" ? "工程师牛牛" : "艺术家小熊"}`);
    }
      addActivity(`制作人小花向${target === "coder" ? "工程师牛牛" : "艺术家小熊"}发送任务`);
      setHandoffDraft(null);
      if (target === "coder") {
        setGeneratingAgents((current) => ({ ...current, coder: true }));
        setAgentStartedAt((current) => ({ ...current, coder: current.coder ?? Date.now() }));
        setCompletedAgents((current) => ({ ...current, coder: false }));
        setAgentErrors((current) => ({ ...current, coder: undefined }));
        setAgentProgress((current) => ({ ...current, coder: "Codex 正在执行小花交办的任务…" }));
        showNotice("工程任务已交给牛牛，Codex 正在开始修改");
        try {
          const createResponse = await fetch("/api/coding-runs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: project.id, handoffTaskId: handoffDraft.taskId }),
          });
          const createPayload = await createResponse.json().catch(() => null) as { run?: CodingRunView; error?: string } | null;
          if (!createResponse.ok || !createPayload?.run) throw new Error(createPayload?.error || "暂时无法启动 Codex。");
          const executeResponse = await fetch(`/api/coding-runs/${createPayload.run.id}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: project.id }),
          });
          const executePayload = await executeResponse.json().catch(() => null) as { error?: string; message?: AgentApiMessage } | null;
          if (!executeResponse.ok) throw new Error(executePayload?.error || "Codex 执行失败。");
          if (executePayload?.message) handleCodingReply(toChatMessage(executePayload.message));
          setCompletedAgents((current) => ({ ...current, coder: true }));
          showNotice("Codex 已完成小花交办的任务，请到牛牛中检查结果");
        } catch (executionError) {
          const message = executionError instanceof Error ? executionError.message : "Codex 执行失败。";
          setAgentErrors((current) => ({ ...current, coder: message }));
          showNotice(message);
        } finally {
          setGeneratingAgents((current) => ({ ...current, coder: false }));
          setAgentStartedAt((current) => ({ ...current, coder: undefined }));
          setAgentProgress((current) => ({ ...current, coder: undefined }));
          window.dispatchEvent(new Event("sugar:coding-runs-changed"));
        }
      } else {
        showNotice("任务已发送给艺术家小熊");
      }
    } catch (error) {
      setHandoffError(error instanceof Error ? error.message : "任务发送失败。");
    } finally {
      setIsSendingHandoff(false);
    }
  };

  const handleSendMessage = async (agentId: AgentId, body: string, attachments: AgentAttachment[] = []): Promise<AgentSendResult> => {
    if (agentRequestRefs.current[agentId]) return { sent: false, attachmentsAccepted: false };

    const requestId = crypto.randomUUID();
    const optimisticMessageId = `pending-${requestId}`;
    const baseMessage = body.trim() || "请将我上传的文件加入知识库，并概括其中与当前项目最相关的内容。";
    const selectedFileSummary = attachments.length > 0
      ? `\n\n待处理附件：\n${attachments.map((item) => `- ${item.file.name}（${item.saveToFeishu ? `将保存到飞书：${item.materialDestinationLabel || "已选位置"}` : "仅用于本次对话"}）`).join("\n")}`
      : "";
    const userMessage = toChatMessage({
      id: optimisticMessageId,
      role: "user",
      content: `${baseMessage}${selectedFileSummary}`,
      createdAt: new Date().toISOString(),
    });
    setMessages((current) => ({ ...current, [agentId]: [...current[agentId], userMessage] }));

    agentRequestRefs.current[agentId] = requestId;
    setGeneratingAgents((current) => ({ ...current, [agentId]: true }));
    setAgentStartedAt((current) => ({ ...current, [agentId]: Date.now() }));
    setAgentErrors((current) => ({ ...current, [agentId]: undefined }));
    let attachmentsAccepted = attachments.length === 0;

    try {
      const finalized = await fetch("/api/knowledge/unarchived-files/finalize", { method: "POST" }).then((response) => response.ok ? response.json() : null).catch(() => null) as { count?: number } | null;
      if ((finalized?.count ?? 0) > 0) window.dispatchEvent(new CustomEvent("sugar:unarchived-changed"));
      let message = baseMessage;
      let ingestedAttachments: IngestedAttachment[] = [];
      if (attachments.length > 0) {
        const ingested = await ingestKnowledgeAttachments(project.id, attachments, baseMessage, (progress) => {
          setAgentProgress((current) => ({ ...current, [agentId]: progress }));
        });
        ingestedAttachments = ingested;
        attachmentsAccepted = true;
        const readyCount = ingested.filter((item) => item.indexStatus === "ready").length;
        const attachmentSummary = ingested.map((item) =>
          `- ${item.fileName}｜${item.scope === "unarchived" ? "仅用于本次对话" : `已保存到飞书「${item.archiveProjectName}」`}｜${item.indexStatus === "ready" ? "已完成索引" : `已保存，索引处理中${item.indexError ? `（${item.indexError}）` : ""}`}`,
        ).join("\n");
        message = `${baseMessage}\n\n本轮附件已由 Sugar Agent 保存：\n${attachmentSummary}`;
        setMessages((current) => ({
          ...current,
          [agentId]: current[agentId].map((item) => item.id === optimisticMessageId ? { ...item, body: message } : item),
        }));
        addActivity(`你通过${agentMeta[agentId].name}上传了 ${ingested.length} 个知识文件`);
        showNotice(readyCount === ingested.length
          ? `${ingested.length} 个文件已进入知识库`
          : `文件已保存，${readyCount}/${ingested.length} 个已完成索引`);
        setAgentProgress((current) => ({ ...current, [agentId]: `${agentMeta[agentId].name}正在阅读新加入的知识…` }));
      } else {
        setAgentProgress((current) => ({ ...current, [agentId]: agentId === "coder" ? "Codex 正在只读分析…" : `${agentMeta[agentId].name}正在生成回复…` }));
      }
      const response = await fetch(`/api/agents/${agentApiType[agentId]}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          conversationId: conversationIds[agentId],
          requestId,
          message,
          knowledgeAttachments: ingestedAttachments.map((item) => ({
            documentId: item.documentId,
            fileName: item.fileName,
            scope: item.scope,
            indexStatus: item.indexStatus,
          })).filter((item): item is typeof item & { documentId: string } => Boolean(item.documentId)),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { reply?: string; conversationId?: string; error?: string; turn?: { userMessage: AgentApiMessage; assistantMessage: AgentApiMessage } }
        | null;
      if (!response.ok || !payload?.reply || !payload.turn) {
        throw new Error(payload?.error || "Agent 暂时无法生成回复，请稍后重试。");
      }
      if (agentRequestRefs.current[agentId] !== requestId) return { sent: false, attachmentsAccepted };
      setMessages((current) => ({
        ...current,
        [agentId]: [
          ...current[agentId].filter((message) => message.id !== optimisticMessageId),
          toChatMessage(payload.turn!.userMessage),
          toChatMessage(payload.turn!.assistantMessage),
        ],
      }));
      if (payload.conversationId) setConversationIds((current) => ({ ...current, [agentId]: payload.conversationId! }));
      if (agentId === "planner") setSaved(false);
      if (activeAgentRef.current !== agentId || sectionRef.current !== "workspace") {
        setCompletedAgents((current) => ({ ...current, [agentId]: true }));
      }
      return { sent: true, attachmentsAccepted, reply: payload.reply };
    } catch (error) {
      if (agentRequestRefs.current[agentId] !== requestId) return { sent: false, attachmentsAccepted };
      setMessages((current) => ({
        ...current,
        [agentId]: current[agentId].filter((message) => message.id !== optimisticMessageId),
      }));
      setAgentErrors((current) => ({
        ...current,
        [agentId]: attachmentsAccepted && attachments.length > 0
          ? `${error instanceof Error ? error.message : `${agentMeta[agentId].name}暂时无法生成回复。`} 文件已经保存，本条消息未保存；重试时无需重新上传。`
          : `${error instanceof Error ? error.message : "Agent 暂时无法生成回复。"} 本条消息未保存。`,
      }));
      return { sent: false, attachmentsAccepted };
    } finally {
      if (agentRequestRefs.current[agentId] === requestId) {
        delete agentRequestRefs.current[agentId];
        setGeneratingAgents((current) => ({ ...current, [agentId]: false }));
        setAgentStartedAt((current) => ({ ...current, [agentId]: undefined }));
        setAgentProgress((current) => ({ ...current, [agentId]: undefined }));
      }
    }
  };

  const handleConversationChange = async (agentId: AgentId, conversationId: string) => {
    if (agentRequestRefs.current[agentId]) {
      showNotice("请等待当前回复完成后再切换对话");
      return;
    }
    setLoadingAgents((current) => ({ ...current, [agentId]: true }));
    setAgentErrors((current) => ({ ...current, [agentId]: undefined }));
    try {
      const response = await fetch(`/api/agents/${agentApiType[agentId]}/messages?projectId=${encodeURIComponent(project.id)}&conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { messages?: AgentApiMessage[]; error?: string } | null;
      if (!response.ok || !Array.isArray(payload?.messages)) throw new Error(payload?.error || "对话切换失败。");
      setConversationIds((current) => ({ ...current, [agentId]: conversationId }));
      setMessages((current) => ({ ...current, [agentId]: payload.messages!.map(toChatMessage) }));
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "对话切换失败");
    } finally {
      setLoadingAgents((current) => ({ ...current, [agentId]: false }));
    }
  };

  const handleCodingReply = (message: ChatMessage) => {
    setMessages((current) => current.coder.some((item) => item.id === message.id)
      ? current
      : { ...current, coder: [...current.coder, message] });
    setCompletedAgents((current) => ({ ...current, coder: true }));
    setAgentErrors((current) => ({ ...current, coder: undefined }));
  };

  const confirmQuickHandoff = async (title: string, content: string, priority: "low" | "normal" | "high", projectFileIds: string[]) => {
    if (!quickHandoff || quickHandoffSending) return;
    setQuickHandoffSending(true); setQuickHandoffError(undefined);
    try {
      const response = await fetch("/api/collaboration/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id, sourceAgent: agentApiType[quickHandoff.source], targetAgent: agentApiType[quickHandoff.target], title, content, priority, projectFileIds, taskKind: quickHandoff.source === "client" ? "change_request" : "result", confirmed: true }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.task) throw new Error(payload?.error || "协作任务发送失败。");
      const target = quickHandoff.target;
      setTasks((current) => ({ ...current, [target]: [...current[target], { id: payload.task.id, from: quickHandoff.source, title, content }] }));
      setCompletedAgents((current) => ({ ...current, [target]: true }));
      if (!openAgents.includes(target)) setOpenAgents((agents) => [...agents, target]);
      showNotice(`已交给${agentMeta[target].name}，可在协作任务中跟踪`); setQuickHandoff(null);
    } catch (error) { setQuickHandoffError(error instanceof Error ? error.message : "协作任务发送失败。"); }
    finally { setQuickHandoffSending(false); }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    const { error } = await createClient().auth.signOut({ scope: "local" });

    if (error) {
      setIsSigningOut(false);
      showNotice("退出失败，请稍后重试");
      return;
    }

    router.refresh();
  };

  const handleCreateProject = async (name: string, description: string) => {
    if (creatingProject) return false;
    setCreatingProject(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const payload = (await response.json().catch(() => null)) as { project?: Project; error?: string } | null;
      if (!response.ok || !payload?.project) throw new Error(payload?.error || "项目创建失败。");
      setProjects((current) => [...current, payload.project!]);
      handleProjectChange(payload.project.id, payload.project);
      showNotice(`已创建项目「${payload.project.name}」`);
      return true;
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "项目创建失败。");
      return false;
    } finally {
      setCreatingProject(false);
    }
  };

  const handleProjectChange = (id: string, suppliedProject?: Project) => {
    const next = suppliedProject ?? projects.find((item) => item.id === id);
    if (!next || next.id === projectId) return;
    setProjectId(id);
    setHydratedAgentTabsFor(undefined);
    setLoadingAgents({ planner: true });
    agentRequestRefs.current = {};
    setOpenAgents(["planner"]);
    setActiveAgent("planner");
    activeAgentRef.current = "planner";
    setCompletedAgents({});
    setSection("workspace");
    sectionRef.current = "workspace";
    setMessages(emptyMessages());
    setConversationIds({});
    setTasks({ planner: [], coder: [], designer: [], client: [], buyer: [], marketing: [] });
    setSaved(false);
    setPlanSavePreview(null);
    setPlanSaveError(undefined);
    setGeneratingAgents({});
    setAgentStartedAt({});
    setAgentProgress({});
    setAgentErrors({});
    setDrawer(null);
    setHandoffDraft(null);
    setActivity([{ time: getTime(), text: `你切换到项目「${next.name}」` }]);
    showNotice(`已切换到「${next.name}」`);
  };

  const handleProjectUpdated = (updated: Project) => {
    setProjects((current) => current.map((item) => item.id === updated.id ? updated : item));
  };

  const composerDraftKey = (draftProjectId: string, agentId: AgentId) => `${draftProjectId}:${agentId}`;
  const handleComposerValueChange = (agentId: AgentId, value: string) => {
    const key = composerDraftKey(project.id, agentId);
    setComposerDrafts((current) => {
      if (!value) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      return current[key] === value ? current : { ...current, [key]: value };
    });
  };

  return (
    <div className="flex h-screen min-h-[680px] w-full overflow-hidden bg-[#f7f7f4]">
      <Sidebar
        projects={projects}
        projectId={projectId}
        activeDrawer={drawer}
        currentUser={{ ...currentUser, role: project.role }}
        isSigningOut={isSigningOut}
        isCreatingProject={creatingProject}
        onProjectChange={(id) => handleProjectChange(id)}
        onCreateProject={handleCreateProject}
        onOpenDrawer={setDrawer}
        onSignOut={handleSignOut}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          project={project}
          section={section}
          onSectionChange={(nextSection) => {
            sectionRef.current = nextSection;
            setSection(nextSection);
          }}
          onOpenProjectSettings={() => setProjectSettingsOpen(true)}
        />
        {!hasModelConfig && (
          <div className="flex h-9 shrink-0 items-center border-b border-[#e4e3de] bg-[#fbf7eb] px-4 text-body text-[#756646]">
            尚未配置可用模型。Agent 暂时不会执行真实模型任务。
            <Link href="/settings/models" className="ml-2 font-medium text-[#4e654f] underline decoration-[#9eb0a2] underline-offset-2">
              前往模型设置
            </Link>
          </div>
        )}
        {section === "workspace" ? (
          <AgentWorkspace
            project={project}
            openAgents={openAgents}
            activeAgent={activeAgent}
            completedAgents={completedAgents}
            messages={messages}
            tasks={tasks}
            saved={saved}
            onSave={handleSave}
            onHandoff={(target) => void prepareHandoff(target)}
            onCloseAgent={handleCloseAgent}
            onActivateAgent={handleActivateAgent}
            onSendMessage={handleSendMessage}
            generatingAgents={generatingAgents}
            agentErrors={agentErrors}
            loadingAgents={loadingAgents}
            onAddAgent={() => setPickerOpen(true)}
            projectId={project.id}
            onNotice={showNotice}
            conversationIds={conversationIds}
            onConversationChange={(agentId, conversationId) => void handleConversationChange(agentId, conversationId)}
            onReturnHandoff={(source, target, content) => { setQuickHandoff({ source, target, content, title: source === "client" ? "客户反馈与待确认事项" : source === "marketing" && target === "designer" ? "营销内容配图需求" : `${agentMeta[source].name}工作结果` }); setQuickHandoffError(undefined); }}
            onCodingReply={handleCodingReply}
            onCodingExecutionState={(working, executionError) => {
              setGeneratingAgents((current) => ({ ...current, coder: working }));
              setAgentStartedAt((current) => ({ ...current, coder: working ? current.coder ?? Date.now() : undefined }));
              setAgentProgress((current) => ({ ...current, coder: working ? "Codex 正在修改代码…" : undefined }));
              if (executionError) setAgentErrors((current) => ({ ...current, coder: executionError }));
              else if (working) setAgentErrors((current) => ({ ...current, coder: undefined }));
            }}
            isPreparingSave={isPreparingPlanSave}
            preparingHandoff={preparingHandoff}
            agentProgress={agentProgress}
            agentStartedAt={agentStartedAt}
            composerValue={activeAgent ? composerDrafts[composerDraftKey(project.id, activeAgent)] ?? "" : ""}
            onComposerValueChange={handleComposerValueChange}
          />
        ) : (
          <ProjectSectionView key={`${project.id}:${project.description}:${project.currentStage}`} section={section} project={project} onNotice={showNotice} onProjectUpdated={handleProjectUpdated} />
        )}
      </div>

      {pickerOpen && (
        <AgentPicker openAgents={openAgents} onAdd={handleAddAgent} onClose={() => setPickerOpen(false)} />
      )}
      {handoffDraft && (
        <HandoffModal
          target={handoffDraft.target}
          initialBrief={handoffDraft.brief}
          isSending={isSendingHandoff}
          error={handoffError}
          onCancel={() => {
            if (!isSendingHandoff) {
              setHandoffDraft(null);
              setHandoffError(undefined);
            }
          }}
          onConfirm={confirmHandoff}
        />
      )}
      {planSavePreview && (
        <PlanSaveModal
          preview={planSavePreview}
          isSaving={isSavingPlan}
          error={planSaveError}
          onCancel={() => {
            if (!isSavingPlan) {
              setPlanSavePreview(null);
              setPlanSaveError(undefined);
            }
          }}
          onConfirm={confirmPlanSave}
        />
      )}
      {drawer && (
        <WorkspaceDrawer
          drawer={drawer}
          activity={activity}
          databaseProjectId={project.id}
          onClose={() => setDrawer(null)}
          onNotice={showNotice}
        />
      )}
      {projectSettingsOpen && (
        <ProjectSettingsModal
          project={project}
          currentUserEmail={currentUser.email}
          onClose={() => setProjectSettingsOpen(false)}
          onUpdated={handleProjectUpdated}
          onNotice={showNotice}
        />
      )}
      {quickHandoff && <QuickHandoffModal projectId={project.id} source={quickHandoff.source} target={quickHandoff.target} initialTitle={quickHandoff.title} initialContent={quickHandoff.content} sending={quickHandoffSending} error={quickHandoffError} onCancel={() => { if (!quickHandoffSending) setQuickHandoff(null); }} onConfirm={(title, content, priority, projectFileIds) => void confirmQuickHandoff(title, content, priority, projectFileIds)} />}
      <UnarchivedFilesNotice projects={projects.map(({ id, name }) => ({ id, name }))} onNotice={showNotice} />

      {toast && (
        <div role="status" className="panel-in fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-[8px] border border-[#d8ded9] bg-[#243f34] px-3.5 py-2.5 text-body font-medium text-white shadow-[0_12px_34px_rgba(20,40,30,0.2)]">
          <span className="mr-2 text-[#aed0be]">✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}
