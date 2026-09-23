"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marketingPlatformLabels, type MarketingPlatform } from "../lib/marketing/types";
import { MarketingImageTools } from "./MarketingImageTools";

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
  status: "draft" | "in_review" | "completed" | "archived";
  publishAccount: string;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Section = "draft" | "completed";

function formatDateTime(value: string | null) {
  if (!value) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function MarketingContentPanel({
  projectId,
  disabled,
  onNotice,
  onActiveWorkChange,
}: {
  projectId: string | null;
  disabled: boolean;
  onNotice: (message: string) => void;
  onActiveWorkChange?: (workId: string | null) => void;
}) {
  const [contents, setContents] = useState<MarketingContent[]>([]);
  const [section, setSection] = useState<Section>("draft");
  const [expanded, setExpanded] = useState<string>();
  const [editing, setEditing] = useState<MarketingContent>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const activeWorkChangeRef = useRef(onActiveWorkChange);

  useEffect(() => {
    activeWorkChangeRef.current = onActiveWorkChange;
  }, [onActiveWorkChange]);

  const load = useCallback(async () => {
    if (!projectId) {
      setContents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/marketing-contents?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { contents?: MarketingContent[] } | null;
      if (!response.ok) throw new Error("暂时无法加载宣传作品。");
      const next = payload?.contents ?? [];
      setContents(next);
      setEditing((current) => current ? next.find((item) => item.id === current.id) ?? current : current);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "暂时无法加载宣传作品。");
    } finally {
      setLoading(false);
    }
  }, [onNotice, projectId]);

  useEffect(() => {
    const pending = window.setTimeout(() => {
      setExpanded(undefined);
      setEditing(undefined);
      activeWorkChangeRef.current?.(null);
      void load();
    }, 0);
    return () => window.clearTimeout(pending);
  }, [load, projectId]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("sugar:marketing-contents-changed", refresh);
    return () => window.removeEventListener("sugar:marketing-contents-changed", refresh);
  }, [load]);

  const visible = useMemo(() => contents.filter((item) => (
    section === "completed" ? item.status === "completed" : item.status === "draft" || item.status === "in_review"
  )), [contents, section]);

  const createBlankDraft = async () => {
    if (!projectId || busy) return;
    setBusy("create");
    try {
      const response = await fetch("/api/marketing-contents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          platform: "xiaohongshu",
          title: "未命名小红书草稿",
          content: "尚未开始创作。请在左侧告诉豆豆这篇内容要解决什么问题。",
        }),
      });
      const payload = await response.json().catch(() => null) as { content?: MarketingContent; error?: string } | null;
      if (!response.ok || !payload?.content) throw new Error(payload?.error || "新建草稿失败。");
      await load();
      setSection("draft");
      setExpanded(payload.content.id);
      setEditing(payload.content);
      onActiveWorkChange?.(payload.content.id);
      onNotice("草稿已新建，可以在左侧告诉豆豆要写什么");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "新建草稿失败。");
    } finally {
      setBusy(undefined);
    }
  };

  const openContent = (item: MarketingContent) => {
    if (expanded === item.id) {
      setExpanded(undefined);
      setEditing(undefined);
      onActiveWorkChange?.(null);
      return;
    }
    setExpanded(item.id);
    setEditing({ ...item });
    onActiveWorkChange?.(item.id);
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
          publishAccount: next.publishAccount,
          scheduledAt: next.scheduledAt,
          status: next.status,
        }),
      });
      const payload = await response.json().catch(() => null) as { updated?: boolean; error?: string } | null;
      if (!response.ok || !payload?.updated) throw new Error(payload?.error || "宣传作品保存失败。");
      onNotice(updates?.status === "completed" ? "作品已移入已完成" : "作品修改已保存");
      if (updates?.status === "completed") {
        setExpanded(undefined);
        setEditing(undefined);
        onActiveWorkChange?.(null);
      }
      await load();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "宣传作品保存失败。");
    } finally {
      setBusy(undefined);
    }
  };

  const archive = async (item: MarketingContent) => {
    if (!projectId || busy || !window.confirm(`归档「${item.title}」？`)) return;
    setBusy(`${item.id}:archive`);
    try {
      const response = await fetch(`/api/marketing-contents/${item.id}?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("宣传作品归档失败。");
      setExpanded(undefined);
      setEditing(undefined);
      onActiveWorkChange?.(null);
      await load();
      onNotice("宣传作品已归档");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "宣传作品归档失败。");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#fafaf8]" aria-label="宣传作品区">
      <header className="shrink-0 border-b border-[#e5e4df] bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-body font-semibold text-[#34342f]">宣传作品</h3>
            <p className="mt-0.5 text-caption text-[#999890]">在右侧选择作品后，豆豆会围绕它继续工作</p>
          </div>
          <button type="button" disabled={disabled || !!busy || !projectId} onClick={() => void createBlankDraft()} className="h-8 rounded-md border border-[#bfd0c6] bg-white px-3 text-control font-medium text-[#456657] disabled:opacity-40">
            {busy === "create" ? "新建中…" : "＋ 新建草稿"}
          </button>
        </div>
      </header>

      <div className="grid h-11 shrink-0 grid-cols-2 border-b border-[#e8e7e2] bg-white p-1">
        {(["draft", "completed"] as const).map((value) => (
          <button key={value} type="button" onClick={() => setSection(value)} className={`rounded-md text-control ${section === value ? "bg-[#eceeea] font-medium text-[#384b41]" : "text-[#85847c]"}`}>
            {value === "draft" ? "草稿箱" : "已完成"}
          </button>
        ))}
      </div>

      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        {loading && <p role="status" className="py-8 text-center text-control text-[#999890]">正在加载宣传作品…</p>}
        {!loading && visible.length === 0 && (
          <div className="grid min-h-48 place-items-center rounded-[9px] border border-dashed border-[#deddd8] bg-white p-6 text-center">
            <div><p className="text-body font-medium text-[#62615b]">{section === "draft" ? "草稿箱还是空的" : "还没有已完成作品"}</p><p className="mt-1 text-control text-[#aaa9a1]">{section === "draft" ? "新建草稿，再在左侧和豆豆一起完成。" : "确认定稿后，作品会出现在这里。"}</p></div>
          </div>
        )}
        <div className="space-y-2">
          {visible.map((item) => (
            <article key={item.id} className="rounded-[9px] border border-[#e1e0db] bg-white">
              <button type="button" onClick={() => openContent(item)} className="flex w-full items-start gap-2 px-3 py-3 text-left">
                <span className="rounded bg-[#f8ece8] px-1.5 py-0.5 text-micro font-medium text-[#9a5f50]">{marketingPlatformLabels[item.platform]}</span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-control font-medium text-[#41413c]">{item.title}</strong>
                  <small className="mt-1 block text-caption text-[#aaa9a1]">{item.publishAccount || "未设置账号"} · {item.status === "completed" ? `完成于 ${formatDateTime(item.completedAt ?? item.updatedAt)}` : `预计 ${formatDateTime(item.scheduledAt)}`}</small>
                </span>
                <span className="text-caption text-[#aaa9a1]">{expanded === item.id ? "收起" : "查看"}</span>
              </button>

              {expanded === item.id && editing?.id === item.id && (
                <div className="space-y-3 border-t border-[#ecebe7] px-3 py-3">
                  <div className="grid grid-cols-[1fr_112px] gap-2">
                    <input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} className="h-9 min-w-0 rounded border border-[#deddd8] px-2 text-control outline-none" />
                    <select value={editing.platform} onChange={(event) => setEditing({ ...editing, platform: event.target.value as MarketingPlatform })} className="h-9 rounded border border-[#deddd8] px-2 text-control">
                      <option value="xiaohongshu">小红书</option><option value="wechat">公众号</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={editing.publishAccount} onChange={(event) => setEditing({ ...editing, publishAccount: event.target.value })} placeholder="发布账号" className="h-9 rounded border border-[#deddd8] px-2 text-control outline-none" />
                    <input type="datetime-local" value={toDateTimeLocal(editing.scheduledAt)} onChange={(event) => setEditing({ ...editing, scheduledAt: event.target.value ? new Date(event.target.value).toISOString() : null })} className="h-9 rounded border border-[#deddd8] px-2 text-control outline-none" />
                  </div>

                  <div>
                    <label className="mb-1 block text-caption font-medium text-[#74736c]">文案</label>
                    <textarea value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} rows={12} className="w-full resize-y rounded border border-[#deddd8] p-2.5 text-control leading-5 outline-none" />
                  </div>
                  <div>
                    <label className="mb-1 block text-caption font-medium text-[#74736c]">豆豆给出的图片建议</label>
                    <textarea value={editing.imagePlan} onChange={(event) => setEditing({ ...editing, imagePlan: event.target.value })} rows={5} placeholder="豆豆完成创作后，图片建议会出现在这里；你也可以直接修改。" className="w-full resize-y rounded border border-[#deddd8] p-2.5 text-control leading-5 outline-none" />
                  </div>

                  <MarketingImageTools
                    projectId={projectId!}
                    contentId={item.id}
                    imagePlan={editing.imagePlan}
                    onNotice={onNotice}
                    onRefresh={load}
                    onGenerateImagePrompt={async (suggestion) => {
                      const response = await fetch("/api/agents/marketing/image-prompt", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ projectId, marketingContentId: item.id, suggestion }),
                      });
                      const payload = await response.json().catch(() => null) as { prompt?: string; error?: string } | null;
                      if (!response.ok || !payload?.prompt) throw new Error(payload?.error || "豆豆暂时无法整理图片指令。");
                      return payload.prompt;
                    }}
                  />

                  <div className="flex flex-wrap gap-1.5 border-t border-[#ecebe7] pt-3">
                    <button type="button" disabled={!!busy || !editing.title.trim() || !editing.content.trim()} onClick={() => void updateContent(item)} className="h-8 rounded border border-[#cfd4d0] px-3 text-control font-medium disabled:opacity-35">{busy === `${item.id}:save` ? "保存中…" : "保存修改"}</button>
                    {item.status !== "completed" && <button type="button" disabled={!!busy} onClick={() => void updateContent(item, { status: "completed" })} className="h-8 rounded bg-[#314a3f] px-3 text-control text-white disabled:opacity-35">标记为已完成</button>}
                    <button type="button" onClick={() => { void navigator.clipboard.writeText(editing.content); onNotice("文案已复制"); }} className="h-8 rounded border border-[#cfd4d0] px-3 text-control">复制文案</button>
                    <button type="button" disabled={!!busy} onClick={() => void archive(item)} className="ml-auto h-8 px-1 text-control text-[#9a7467]">归档</button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
