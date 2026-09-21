"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentId } from "./types";

const apiType: Record<AgentId, string> = { planner: "planning", coder: "coding", designer: "design", client: "client", buyer: "procurement", marketing: "marketing" };
type Conversation = { id: string; title: string; status: "active" | "archived"; isCurrent: boolean; hasSummary: boolean; updatedAt: string };
type SearchResult = { conversationId: string; conversationTitle: string; content: string; role: string };

export function ConversationBar({ projectId, agentId, conversationId, refreshKey, onSelect, onNotice }: {
  projectId: string | null; agentId: AgentId; conversationId?: string; refreshKey: number;
  onSelect: (conversationId: string) => void; onNotice: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Conversation[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState<string>();
  const [loading, setLoading] = useState(true);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/agent-conversations?projectId=${encodeURIComponent(projectId)}&agentType=${apiType[agentId]}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (response.ok) setItems(body.conversations ?? []);
    } finally { setLoading(false); }
  }, [agentId, projectId]);

  useEffect(() => { const pending = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(pending); }, [load, refreshKey]);
  useEffect(() => { const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  const current = items.find((item) => item.id === conversationId) ?? items.find((item) => item.isCurrent);

  const create = async () => {
    if (!projectId || busy) return;
    setBusy("create");
    try {
      const response = await fetch("/api/agent-conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, agentType: apiType[agentId], title: "新对话" }) });
      const body = await response.json().catch(() => null);
      if (response.ok) { onSelect(body.conversation.id); setOpen(false); await load(); }
      else onNotice(body?.error || "新对话创建失败");
    } catch { onNotice("网络异常，新对话未创建"); }
    finally { setBusy(undefined); }
  };

  const select = async (id: string) => {
    if (busy || id === (conversationId ?? current?.id)) { setOpen(false); return; }
    const previousId = conversationId ?? current?.id;
    setBusy(`select:${id}`);
    // The chosen conversation is known and access-controlled already. Render it
    // immediately while the server records it as the new current conversation.
    onSelect(id); setOpen(false);
    try {
      const response = await fetch(`/api/agent-conversations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "select" }) });
      const body = await response.json().catch(() => null);
      if (response.ok) await load();
      else { if (previousId) onSelect(previousId); onNotice(body?.error || "切换对话失败"); }
    } catch { if (previousId) onSelect(previousId); onNotice("网络异常，对话未切换"); }
    finally { setBusy(undefined); }
  };

  const rename = async (item: Conversation) => {
    const title = window.prompt("重命名对话", item.title)?.trim();
    if (!title || busy) return;
    setBusy(`rename:${item.id}`);
    const previous = items;
    setItems((currentItems) => currentItems.map((entry) => entry.id === item.id ? { ...entry, title } : entry));
    try {
      const response = await fetch(`/api/agent-conversations/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rename", title }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setItems(previous); onNotice(body?.error || "重命名失败"); }
      else onNotice("对话已重命名");
    } catch { setItems(previous); onNotice("网络异常，对话名称未修改"); }
    finally { setBusy(undefined); }
  };

  const archive = async (item: Conversation) => {
    if (busy || !window.confirm(`归档对话「${item.title}」？历史不会删除。`)) return;
    setBusy(`archive:${item.id}`);
    try {
      const response = await fetch(`/api/agent-conversations/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive" }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { onNotice(body?.error || "归档失败"); return; }
      await load();
      if (item.id === conversationId) {
        const listResponse = await fetch(`/api/agent-conversations?projectId=${projectId}&agentType=${apiType[agentId]}`);
        const list = await listResponse.json();
        const next = list.conversations?.find((conversation: Conversation) => conversation.isCurrent);
        if (next) onSelect(next.id);
      }
      onNotice("对话已归档");
    } catch { onNotice("网络异常，对话未归档"); }
    finally { setBusy(undefined); }
  };

  const search = async () => {
    if (!projectId || !query.trim() || busy) { if (!query.trim()) setResults([]); return; }
    setBusy("search");
    try {
      const response = await fetch(`/api/agent-conversations/search?projectId=${projectId}&agentType=${apiType[agentId]}&q=${encodeURIComponent(query)}`);
      const body = await response.json().catch(() => null);
      setResults(response.ok ? body.results ?? [] : []);
      if (!response.ok) onNotice(body?.error || "历史消息搜索失败");
    } catch { setResults([]); onNotice("网络异常，搜索未完成"); }
    finally { setBusy(undefined); }
  };

  return <div ref={root} className="relative flex h-8 shrink-0 items-center border-b border-[#eeeeea] bg-[#fafaf8] px-4 text-caption text-[#7d7d76]">
    <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-w-0 items-center gap-1.5 hover:text-[#454640]"><span className="truncate">{loading ? "正在加载对话…" : current?.title ?? "当前对话"}</span>{current?.hasSummary && <span title="已建立长期摘要" className="text-[#628070]">记忆</span>}<span>⌄</span></button>
    <button type="button" aria-busy={busy === "create"} onClick={() => void create()} disabled={!!busy || !projectId} className="ml-auto rounded px-1.5 py-1 hover:bg-[#eeeeea] disabled:opacity-30">{busy === "create" ? "创建中…" : "＋ 新对话"}</button>
    {open && <div className="panel-in absolute left-3 top-8 z-40 w-[280px] rounded-[8px] border border-[#deded8] bg-white p-2 shadow-[0_14px_40px_rgba(20,20,18,.14)]">
      <div className="flex gap-1"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="搜索自己的历史消息" className="h-7 min-w-0 flex-1 rounded border border-[#e1e1dc] px-2 text-caption outline-none" /><button aria-busy={busy === "search"} disabled={!!busy} onClick={() => void search()} className="rounded border border-[#e1e1dc] px-2 disabled:opacity-40">{busy === "search" ? "搜索中…" : "搜索"}</button></div>
      {query && results.length > 0 && <div className="mt-2 max-h-28 overflow-y-auto border-b border-[#eeeeea] pb-2">{results.slice(0, 6).map((result) => <button disabled={!!busy} key={`${result.conversationId}-${result.content}`} onClick={() => void select(result.conversationId)} className="block w-full rounded px-2 py-1.5 text-left hover:bg-[#f5f5f2] disabled:opacity-40"><span className="block truncate font-medium text-[#55564f]">{result.conversationTitle}</span><span className="block truncate text-[#999991]">{result.content}</span></button>)}</div>}
      <div className="mt-1 max-h-52 overflow-y-auto">{items.filter((item) => item.status === "active").map((item) => <div key={item.id} className={`group flex items-center rounded ${item.id === (conversationId ?? current?.id) ? "bg-[#eef3ef]" : "hover:bg-[#f5f5f2]"}`}><button aria-busy={busy === `select:${item.id}`} disabled={!!busy} onClick={() => void select(item.id)} className="min-w-0 flex-1 truncate px-2 py-2 text-left text-control text-[#55564f] disabled:opacity-50">{busy === `select:${item.id}` ? "切换中…" : item.title}</button><button disabled={!!busy} onClick={() => void rename(item)} title="重命名" className="px-1 opacity-0 group-hover:opacity-100 disabled:opacity-20">{busy === `rename:${item.id}` ? "…" : "✎"}</button><button disabled={!!busy} onClick={() => void archive(item)} title="归档" className="px-2 opacity-0 group-hover:opacity-100 disabled:opacity-20">{busy === `archive:${item.id}` ? "…" : "×"}</button></div>)}</div>
    </div>}
  </div>;
}
