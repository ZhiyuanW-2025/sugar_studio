"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  marketingPlatformLabels,
  marketingStatusLabels,
  type MarketingPlatform,
  type MarketingStatus,
} from "../lib/marketing/types";
import type { ChatMessage } from "./types";

type MarketingContent = {
  id: string;
  projectId: string;
  platform: MarketingPlatform;
  title: string;
  summary: string;
  content: string;
  coverCopy: string;
  tags: string[];
  imagePlan: string;
  status: MarketingStatus;
  createdAt: string;
  updatedAt: string;
};

type Filter = "all" | "draft" | "in_review" | "completed";
const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "in_review", label: "待确认" },
  { value: "completed", label: "已完成" },
];

function defaultTitle(message: string, platform: MarketingPlatform) {
  const first = message.split("\n").map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim()).find(Boolean);
  return (first || `${marketingPlatformLabels[platform]}营销内容`).slice(0, 80);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function MarketingContentPanel({
  projectId,
  disabled,
  latestMessage,
  onCreateDraft,
  onHandoffToDesigner,
  onNotice,
}: {
  projectId: string | null;
  disabled: boolean;
  latestMessage?: ChatMessage;
  onCreateDraft: (message: string) => void;
  onHandoffToDesigner: (content: string) => void;
  onNotice: (message: string) => void;
}) {
  const [platform, setPlatform] = useState<MarketingPlatform>("xiaohongshu");
  const [audience, setAudience] = useState("");
  const [objective, setObjective] = useState("");
  const [saveTitle, setSaveTitle] = useState("");
  const [contents, setContents] = useState<MarketingContent[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string>();
  const [editing, setEditing] = useState<MarketingContent>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/marketing-contents?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { contents?: MarketingContent[] } | null;
      if (response.ok) setContents(payload?.contents ?? []);
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => {
    const pending = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(pending);
  }, [load]);

  const visible = useMemo(
    () => filter === "all" ? contents : contents.filter((item) => item.status === filter),
    [contents, filter],
  );

  const askDoudou = () => {
    if (!objective.trim() || disabled) return;
    onCreateDraft([
      "请为当前项目策划并起草一份可保存的营销图文内容。",
      `目标平台：${marketingPlatformLabels[platform]}`,
      `传播目标与必须包含的内容：\n${objective.trim()}`,
      `目标受众：${audience.trim() || "请结合项目判断；无法确定的信息标记待确认"}`,
      "请读取正式项目上下文和需要的项目材料。输出标题候选、可直接编辑的正文、封面文案、配图清单，以及该平台需要的标签或发布备注。不要声称已经发布。",
    ].join("\n\n"));
  };

  const saveLatest = async () => {
    if (!projectId || !latestMessage?.body.trim() || busy) return;
    setBusy("create");
    try {
      const response = await fetch("/api/marketing-contents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          platform,
          title: saveTitle.trim() || defaultTitle(latestMessage.body, platform),
          content: latestMessage.body,
          summary: objective.trim(),
        }),
      });
      const payload = await response.json().catch(() => null) as { created?: boolean; error?: string } | null;
      if (!response.ok || !payload?.created) throw new Error(payload?.error || "营销草稿保存失败。");
      setSaveTitle("");
      onNotice("已保存到营销内容草稿区");
      await load();
    } catch (error) { onNotice(error instanceof Error ? error.message : "营销草稿保存失败。"); }
    finally { setBusy(undefined); }
  };

  const openContent = (item: MarketingContent) => {
    if (expanded === item.id) { setExpanded(undefined); setEditing(undefined); return; }
    setExpanded(item.id);
    setEditing({ ...item });
  };

  const updateContent = async (item: MarketingContent, updates?: Partial<MarketingContent>) => {
    if (!projectId || busy) return;
    const next = { ...(editing?.id === item.id ? editing : item), ...updates };
    setBusy(`${item.id}:save`);
    try {
      const response = await fetch(`/api/marketing-contents/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          platform: next.platform,
          title: next.title,
          content: next.content,
          summary: next.summary,
          coverCopy: next.coverCopy,
          imagePlan: next.imagePlan,
          tags: next.tags,
          status: next.status,
        }),
      });
      const payload = await response.json().catch(() => null) as { updated?: boolean; error?: string } | null;
      if (!response.ok || !payload?.updated) throw new Error(payload?.error || "营销内容更新失败。");
      onNotice(updates?.status === "completed" ? "营销内容已标记为完成" : "营销内容已保存");
      await load();
      if (updates) setEditing((current) => current?.id === item.id ? { ...current, ...updates } : current);
    } catch (error) { onNotice(error instanceof Error ? error.message : "营销内容更新失败。"); }
    finally { setBusy(undefined); }
  };

  const archive = async (item: MarketingContent) => {
    if (!projectId || busy || !window.confirm(`归档「${item.title}」？`)) return;
    setBusy(`${item.id}:archive`);
    try {
      const response = await fetch(`/api/marketing-contents/${item.id}?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("营销内容归档失败。");
      setExpanded(undefined); setEditing(undefined); await load(); onNotice("营销内容已归档");
    } catch (error) { onNotice(error instanceof Error ? error.message : "营销内容归档失败。"); }
    finally { setBusy(undefined); }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#fafaf8]" aria-label="营销内容草稿区">
      <header className="shrink-0 border-b border-[#e5e4df] bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="text-body font-semibold text-[#34342f]">营销内容</h3><p className="mt-0.5 text-caption text-[#999890]">小红书与微信公众号草稿，不会自动发布</p></div>
          <span className="rounded-full bg-[#edf3ef] px-2 py-1 text-caption font-medium text-[#527061]">{contents.length} 篇</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <select value={platform} disabled={disabled} onChange={(event) => setPlatform(event.target.value as MarketingPlatform)} className="h-8 rounded-md border border-[#dcdcd6] bg-white px-2 text-control outline-none">
            <option value="xiaohongshu">小红书</option><option value="wechat">微信公众号</option>
          </select>
          <input value={audience} disabled={disabled} onChange={(event) => setAudience(event.target.value)} placeholder="目标受众（可选）" className="h-8 rounded-md border border-[#dcdcd6] bg-white px-2 text-control outline-none" />
        </div>
        <textarea value={objective} disabled={disabled} onChange={(event) => setObjective(event.target.value)} rows={2} placeholder="这次想传播什么？例如：活动招募，吸引上海 20–30 岁年轻人报名" className="mt-2 w-full resize-none rounded-md border border-[#dcdcd6] bg-white px-2.5 py-2 text-control leading-4 outline-none" />
        <div className="mt-2 flex justify-end"><button type="button" disabled={disabled || !objective.trim()} onClick={askDoudou} className="h-7 rounded-md bg-[#314a3f] px-3 text-caption font-medium text-white disabled:opacity-35">{disabled ? "豆豆起草中…" : "交给豆豆起草"}</button></div>
        {latestMessage && <div className="mt-3 border-t border-[#e9e8e3] pt-3"><div className="flex gap-2"><input value={saveTitle} onChange={(event) => setSaveTitle(event.target.value)} placeholder="草稿标题（默认取回复首行）" className="h-8 min-w-0 flex-1 rounded-md border border-[#dcdcd6] px-2 text-control outline-none" /><button type="button" disabled={!!busy} onClick={() => void saveLatest()} className="h-8 shrink-0 rounded-md border border-[#bfd0c6] bg-white px-2.5 text-caption font-medium text-[#456657] disabled:opacity-40">{busy === "create" ? "保存中…" : "保存豆豆最新回复"}</button></div></div>}
      </header>

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[#e8e7e2] px-3">
        {filters.map((item) => <button key={item.value} onClick={() => setFilter(item.value)} className={`rounded-md px-2 py-1 text-caption ${filter === item.value ? "bg-[#e9eeeb] font-medium text-[#426152]" : "text-[#85847c] hover:bg-[#f0f0ed]"}`}>{item.label}</button>)}
      </div>

      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        {loading && <p role="status" className="py-8 text-center text-control text-[#999890]"><span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#658373]" />正在加载营销内容…</p>}
        {!loading && visible.length === 0 && <div className="grid min-h-48 place-items-center rounded-[9px] border border-dashed border-[#deddd8] bg-white p-6 text-center"><div><p className="text-body font-medium text-[#62615b]">还没有{filter === "all" ? "营销内容" : marketingStatusLabels[filter]}</p><p className="mt-1 text-control text-[#aaa9a1]">从上方发起需求，豆豆完成后保存到这里。</p></div></div>}
        <div className="space-y-2">
          {visible.map((item) => <article key={item.id} className="rounded-[9px] border border-[#e1e0db] bg-white">
            <button type="button" onClick={() => openContent(item)} className="flex w-full items-start gap-2 px-3 py-3 text-left">
              <span className={`mt-0.5 rounded px-1.5 py-0.5 text-micro font-medium ${item.platform === "xiaohongshu" ? "bg-[#f8ece8] text-[#9a5f50]" : "bg-[#eaf2ec] text-[#4e765c]"}`}>{marketingPlatformLabels[item.platform]}</span>
              <span className="min-w-0 flex-1"><strong className="block truncate text-control font-medium text-[#41413c]">{item.title}</strong><small className="mt-1 block text-caption text-[#aaa9a1]">{marketingStatusLabels[item.status]} · {formatTime(item.updatedAt)}</small></span><span className="text-caption text-[#aaa9a1]">{expanded === item.id ? "收起" : "查看"}</span>
            </button>
            {expanded === item.id && editing?.id === item.id && <div className="space-y-2 border-t border-[#ecebe7] px-3 py-3">
              <div className="grid grid-cols-[1fr_116px] gap-2"><input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} className="h-8 min-w-0 rounded border border-[#deddd8] px-2 text-control outline-none" /><select value={editing.platform} onChange={(event) => setEditing({ ...editing, platform: event.target.value as MarketingPlatform })} className="h-8 rounded border border-[#deddd8] px-1.5 text-caption"><option value="xiaohongshu">小红书</option><option value="wechat">公众号</option></select></div>
              <textarea value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} rows={12} className="w-full resize-y rounded border border-[#deddd8] p-2.5 text-control leading-5 outline-none" />
              <div className="flex flex-wrap gap-1.5">
                <button type="button" disabled={!!busy || !editing.title.trim() || !editing.content.trim()} onClick={() => void updateContent(item)} className="h-7 rounded border border-[#d5d5cf] px-2 text-caption font-medium disabled:opacity-35">{busy === `${item.id}:save` ? "保存中…" : "保存修改"}</button>
                {item.status === "draft" && <button type="button" disabled={!!busy} onClick={() => void updateContent(item, { status: "in_review" })} className="h-7 rounded border border-[#d5d5cf] px-2 text-caption">提交确认</button>}
                {item.status !== "completed" && <button type="button" disabled={!!busy} onClick={() => void updateContent(item, { status: "completed" })} className="h-7 rounded bg-[#314a3f] px-2 text-caption text-white disabled:opacity-35">标记完成</button>}
                <button type="button" onClick={() => { void navigator.clipboard.writeText(editing.content); onNotice("正文已复制"); }} className="h-7 rounded border border-[#d5d5cf] px-2 text-caption">复制全文</button>
                <button type="button" onClick={() => onHandoffToDesigner(`请为以下${marketingPlatformLabels[editing.platform]}内容制作配图。请先提取封面与各张配图需求，并保持项目视觉规范。\n\n标题：${editing.title}\n\n正文：\n${editing.content}`)} className="h-7 rounded border border-[#c7d6ce] bg-[#f6faf7] px-2 text-caption font-medium text-[#426152]">交给小熊配图</button>
                <button type="button" disabled={!!busy} onClick={() => void archive(item)} className="ml-auto h-7 px-1 text-caption text-[#9a7467]">归档</button>
              </div>
            </div>}
          </article>)}
        </div>
      </div>
    </section>
  );
}
