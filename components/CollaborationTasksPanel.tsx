"use client";

import { useCallback, useEffect, useState } from "react";

const agentNames: Record<string, string> = { planning: "小花", coding: "牛牛", design: "小熊", client: "小雪", procurement: "拉夫" };
const statuses = { delivered: "待接收", in_progress: "进行中", blocked: "受阻", completed: "已完成", cancelled: "已取消", draft: "草稿", approved: "已批准" } as const;
type Task = { id: string; sourceAgent: string; targetAgent: string; title: string; content: string; status: keyof typeof statuses; priority: string; taskKind: string; updatedAt: string; attachments: unknown[] };

export function CollaborationTasksPanel({ projectId, onNotice }: { projectId: string; onNotice: (message: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]); const [loading, setLoading] = useState(true); const [expanded, setExpanded] = useState<string>();
  const [busy, setBusy] = useState<{ id: string; status: keyof typeof statuses }>();
  const load = useCallback(async () => { const response = await fetch(`/api/collaboration/tasks?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }); const body = await response.json().catch(() => null); if (response.ok) setTasks(body.tasks ?? []); setLoading(false); }, [projectId]);
  useEffect(() => { const pending = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(pending); }, [load]);
  const update = async (id: string, status: keyof typeof statuses) => {
    if (busy) return;
    const previous = tasks;
    setBusy({ id, status });
    setTasks((current) => current.map((task) => task.id === id ? { ...task, status, updatedAt: new Date().toISOString() } : task));
    try {
      const response = await fetch(`/api/collaboration/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setTasks(previous); onNotice(body?.error || "更新失败"); }
      else onNotice("协作任务状态已更新");
    } catch {
      setTasks(previous); onNotice("网络异常，任务状态未更新");
    } finally { setBusy(undefined); }
  };
  if (loading) return <p role="status" className="text-body text-[#999890]"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#557267]" />正在加载协作任务…</p>;
  if (!tasks.length) return <div className="rounded-[8px] border border-dashed border-[#deded8] p-5 text-center text-control leading-5 text-[#999890]">Agent 之间已确认的交接任务会集中显示在这里。</div>;
  return <div className="space-y-2">{tasks.map((task) => <article key={task.id} className="rounded-[8px] border border-[#e2e3df] bg-white p-3"><button type="button" onClick={() => setExpanded(expanded === task.id ? undefined : task.id)} className="w-full text-left"><div className="flex items-center gap-1.5 text-caption text-[#8d8d85]"><span>{agentNames[task.sourceAgent]}</span><span>→</span><span>{agentNames[task.targetAgent]}</span><span className="ml-auto rounded bg-[#f0f2ef] px-1.5 py-0.5">{busy?.id === task.id ? "更新中…" : statuses[task.status]}</span></div><h3 className="mt-1.5 text-body font-medium text-[#41433e]">{task.title}</h3></button>{expanded === task.id && <div className="mt-2 border-t border-[#eeeeea] pt-2"><p className="whitespace-pre-wrap text-control leading-5 text-[#666760]">{task.content}</p>{task.attachments.length > 0 && <p className="mt-2 text-caption text-[#708078]">附件 {task.attachments.length} 项</p>}<div className="mt-2 flex flex-wrap gap-1">{task.status !== "in_progress" && task.status !== "completed" && <button aria-busy={busy?.id === task.id && busy.status === "in_progress"} disabled={!!busy} onClick={() => void update(task.id,"in_progress")} className="rounded border border-[#dcdcd6] px-2 py-1 text-caption disabled:opacity-40">{busy?.id === task.id && busy.status === "in_progress" ? "处理中…" : "开始处理"}</button>}{task.status !== "blocked" && task.status !== "completed" && <button aria-busy={busy?.id === task.id && busy.status === "blocked"} disabled={!!busy} onClick={() => void update(task.id,"blocked")} className="rounded border border-[#e5d9ce] px-2 py-1 text-caption disabled:opacity-40">{busy?.id === task.id && busy.status === "blocked" ? "处理中…" : "标记受阻"}</button>}{task.status !== "completed" && <button aria-busy={busy?.id === task.id && busy.status === "completed"} disabled={!!busy} onClick={() => void update(task.id,"completed")} className="rounded bg-[#365747] px-2 py-1 text-caption text-white disabled:opacity-40">{busy?.id === task.id && busy.status === "completed" ? "完成中…" : "完成"}</button>}</div></div>}</article>)}</div>;
}
