"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { progressCategories, progressCategoryLabels, type ProgressCategory } from "../lib/projects/progress-events";

type Activity = {
  id: string;
  projectId?: string;
  projectName?: string;
  eventType: string;
  category: ProgressCategory;
  status: "completed" | "failed";
  sourceType: "system_action" | "manual";
  actorType: "user" | "agent";
  actor: string;
  memberName: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
};

const categoryMark: Record<ProgressCategory, string> = {
  decision: "决", material: "材", execution: "执", external: "外", management: "管", exception: "!",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const key = date.toDateString();
  if (key === today.toDateString()) return "今天";
  if (key === yesterday.toDateString()) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(date);
}

export function ProjectActivityPanel({ projectId, mine = false }: { projectId?: string; mine?: boolean }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<"all" | ProgressCategory>("all");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const endpoint = mine ? "/api/projects/activity?mine=true" : `/api/projects/activity?projectId=${encodeURIComponent(projectId || "")}`;
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { activities?: Activity[]; error?: string } | null;
      if (!response.ok || !payload?.activities) throw new Error(payload?.error || "暂时无法加载进度记录。");
      setActivities(payload.activities);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法加载进度记录。");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [mine, projectId]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(true), 15_000);
    const supabase = createClient();
    const channel = supabase
      .channel(`activity-${mine ? "mine" : projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_activities", ...(projectId && !mine ? { filter: `project_id=eq.${projectId}` } : {}) }, () => void load(true))
      .subscribe();
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [load, mine, projectId]);

  const visible = useMemo(() => filter === "all" ? activities : activities.filter((item) => item.category === filter), [activities, filter]);
  const groups = useMemo(() => {
    const result: Array<{ label: string; items: Activity[] }> = [];
    for (const item of visible) {
      const label = dayLabel(item.createdAt);
      const current = result.at(-1);
      if (current?.label === label) current.items.push(item);
      else result.push({ label, items: [item] });
    }
    return result;
  }, [visible]);

  if (loading) return <p role="status" className="py-8 text-center text-body text-[#999890]"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#557267]" />正在加载{mine ? "工作日志" : "项目进度"}…</p>;
  if (error) return <p role="alert" className="my-4 rounded-md border border-[#eadfd8] bg-[#fbf5f1] px-3 py-2 text-body text-[#895c49]">{error}</p>;

  return (
    <div>
      <div className="flex min-h-12 flex-wrap items-center gap-1 border-b border-[#ecebe7] py-2">
        {([ ["all", "全部"], ...progressCategories.map((category) => [category, progressCategoryLabels[category]] as const) ] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded-md px-2.5 py-1.5 text-control ${filter === id ? "bg-[#edf2ef] font-medium text-[#426656]" : "text-[#88877f] hover:bg-[#f5f5f2]"}`}>{label}</button>
        ))}
        <span className="ml-auto text-caption text-[#aaa9a1]">自动同步</span>
      </div>
      {visible.length === 0 ? <p className="py-8 text-center text-body text-[#999890]">还没有符合条件的记录</p> : (
        <div className="py-2">
          {groups.map((group) => <section key={group.label} className="py-2">
            <h3 className="mb-1 px-1 text-caption font-medium text-[#aaa9a1]">{group.label}</h3>
            <div className="relative">
              <div className="absolute bottom-5 left-[17px] top-5 w-px bg-[#e5e4df]" />
              {group.items.map((item) => {
                const sourceAgent = typeof item.details?.source_agent_name === "string" ? item.details.source_agent_name : null;
                const byline = item.actorType === "agent"
                  ? `${item.actor} · ${item.memberName} 发起`
                  : sourceAgent ? `${item.memberName} · 来源 ${sourceAgent}` : item.memberName;
                return <div key={item.id} className="relative flex gap-3 py-3">
                  <span className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border bg-white text-caption font-semibold ${item.status === "failed" ? "border-[#ead4cf] text-[#a55e52]" : "border-[#dfe4e1] text-[#587165]"}`}>{categoryMark[item.category]}</span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-start gap-2"><p className="min-w-0 flex-1 text-body font-medium leading-5 text-[#55554f]">{item.summary}</p><span className="shrink-0 rounded bg-[#f3f3ef] px-1.5 py-0.5 text-micro text-[#929188]">{progressCategoryLabels[item.category]}</span></div>
                    <p className="mt-0.5 text-caption text-[#aaa9a1]">{mine && item.projectName ? `${item.projectName} · ` : ""}{byline} · {formatTime(item.createdAt)}</p>
                  </div>
                </div>;
              })}
            </div>
          </section>)}
        </div>
      )}
    </div>
  );
}
