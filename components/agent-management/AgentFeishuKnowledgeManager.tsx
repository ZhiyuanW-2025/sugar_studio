"use client";

import { useEffect, useState } from "react";
import type { AgentDefinition } from "../../lib/agents/catalog";

type Scope = {
  id: string;
  source_url: string;
  display_name: string;
  sync_frequency: "manual" | "weekly";
  last_full_sync_at: string | null;
  last_sync_status: "pending" | "syncing" | "ready" | "failed";
  last_sync_error: string | null;
};
type DocumentRow = {
  id: string;
  title: string;
  objType: string;
  sourceUrl: string | null;
  externalUpdatedAt: string | null;
  lastSyncedAt: string | null;
  syncStatus: string;
  documentId: string | null;
  indexStatus: "pending" | "processing" | "ready" | "failed" | "unsupported";
  indexedAt: string | null;
  indexError: string | null;
};

export function AgentFeishuKnowledgeManager({ agent }: { agent: AgentDefinition }) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = async () => {
    setLoading(true);
    const response = await fetch(`/api/agents/feishu-knowledge?agentType=${agent.type}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { scope?: Scope | null; documents?: DocumentRow[]; error?: string } | null;
    setLoading(false);
    if (!response.ok) { setError(payload?.error || "暂时无法读取飞书通用知识库连接。"); return; }
    setScope(payload?.scope ?? null);
    setDocuments(payload?.documents ?? []);
  };

  useEffect(() => {
    // This effect synchronizes the editor with the server-owned connection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.type]);

  const sync = async (scopeId: string, initial = false) => {
    const response = await fetch("/api/knowledge/feishu/sync", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopeId, force: initial }),
    });
    const payload = await response.json().catch(() => null) as { documentIds?: string[]; failed?: number; error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || "飞书知识库同步失败。");
    for (const documentId of payload?.documentIds ?? []) {
      const indexResponse = await fetch(`/api/knowledge/documents/${documentId}/index`, { method: "POST" });
      if (!indexResponse.ok) throw new Error("飞书资料已同步，但知识索引建立失败，请检查模型设置后重试。");
    }
    if ((payload?.failed ?? 0) > 0) throw new Error(`有 ${payload?.failed} 份资料同步失败，请检查飞书权限。`);
  };

  const connect = async () => {
    if (!url.trim() || busy) return;
    setBusy(true); setError(undefined);
    try {
      const response = await fetch("/api/agents/feishu-knowledge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentType: agent.type, sourceUrl: url.trim(), syncFrequency: "weekly" }),
      });
      const payload = await response.json().catch(() => null) as { scope?: Scope; error?: string } | null;
      if (!response.ok || !payload?.scope) throw new Error(payload?.error || "连接飞书知识库失败。");
      setScope(payload.scope);
      setUrl("");
      await sync(payload.scope.id, true);
      setNotice("Agent 通用知识库已连接并完成同步");
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : "连接飞书知识库失败。"); }
    finally { setBusy(false); }
  };

  const resync = async () => {
    if (!scope || busy) return;
    setBusy(true); setError(undefined);
    try {
      await sync(scope.id);
      setNotice("Agent 通用知识库已更新");
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : "同步飞书知识库失败。"); }
    finally { setBusy(false); }
  };

  const indexDocument = async (document: DocumentRow) => {
    if (!document.documentId || busy) return;
    setBusy(true); setError(undefined);
    try {
      const response = await fetch(`/api/knowledge/documents/${document.documentId}/index`, { method: "POST" });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "知识解析失败。");
      setNotice(`“${document.title}”已完成解析`);
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : "知识解析失败。"); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!scope || busy || !window.confirm("解除后不会删除飞书原文，只会取消它与当前 Agent 的关联。")) return;
    setBusy(true); setError(undefined);
    try {
      const response = await fetch("/api/agents/feishu-knowledge", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentType: agent.type }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "解除飞书知识库失败。");
      setScope(null); setNotice("已解除 Agent 通用知识库");
    } catch (value) { setError(value instanceof Error ? value.message : "解除飞书知识库失败。"); }
    finally { setBusy(false); }
  };

  return <section className="mt-7 rounded-[8px] border border-[#dfe5e1] bg-[#f8faf8] p-4">
    <div className="flex items-start gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] bg-[#3370ff] text-body font-semibold text-white">飞</div><div><h3 className="text-body font-semibold text-[#393a36]">Agent 通用知识库</h3><p className="mt-1 text-control leading-5 text-[#7c817d]">连接飞书里的工作方法、规范和模板，让 {agent.name} 在所有项目中都能参考。</p></div></div>
    {loading ? <p className="mt-3 text-control text-[#999890]">正在读取连接…</p> : scope ? <div className="mt-3 rounded-md border border-[#e1e5e2] bg-white p-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="truncate text-body font-medium text-[#555b57]">{scope.display_name}</p><p className="mt-1 truncate text-caption text-[#999d99]">{scope.source_url}</p><p className="mt-1 text-caption text-[#777c78]">{scope.last_full_sync_at ? `上次同步：${new Date(scope.last_full_sync_at).toLocaleString("zh-CN")}` : "等待首次同步"} · {scope.last_sync_status === "ready" ? "已就绪" : scope.last_sync_status === "failed" ? "同步失败" : "同步中"}</p>{scope.last_sync_error && <p className="mt-1 text-caption text-[#98584b]">{scope.last_sync_error}</p>}</div><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${scope.last_sync_status === "ready" ? "bg-[#6f8d7e]" : scope.last_sync_status === "failed" ? "bg-[#b77767]" : "animate-pulse bg-[#c1a66f]"}`} /></div><div className="mt-3 flex gap-2"><button type="button" onClick={() => void resync()} disabled={busy} className="h-8 rounded-md border border-[#d9ddd9] px-3 text-control text-[#606560] disabled:opacity-45">{busy ? "同步中…" : "立即同步"}</button><a href={scope.source_url} target="_blank" rel="noreferrer" className="grid h-8 place-items-center rounded-md border border-[#d9ddd9] px-3 text-control text-[#66748a]">在飞书查看 ↗</a><button type="button" onClick={() => void disconnect()} disabled={busy} className="ml-auto h-8 px-2 text-control text-[#9a5f53] disabled:opacity-45">解除连接</button></div>{documents.length > 0 && <div className="mt-4 border-t border-[#edf0ed] pt-3"><div className="mb-2 flex items-center justify-between"><p className="text-control font-medium text-[#555b57]">知识库文件</p><span className="text-caption text-[#999d99]">{documents.length} 项</span></div><div className="divide-y divide-[#edf0ed]">{documents.map((document) => <div key={document.id} className="flex items-center gap-2 py-2"><div className="min-w-0 flex-1"><p className="truncate text-control text-[#555b57]">{document.title}</p><p className="mt-0.5 text-caption text-[#999d99]">{document.externalUpdatedAt ? `飞书更新：${new Date(document.externalUpdatedAt).toLocaleString("zh-CN")}` : "飞书更新时间未知"}</p></div><span className={`shrink-0 text-caption ${document.indexStatus === "ready" ? "text-[#547264]" : document.indexStatus === "failed" ? "text-[#98584b]" : document.indexStatus === "unsupported" ? "text-[#999890]" : "text-[#ad8655]"}`}>{document.indexStatus === "ready" ? "已解析" : document.indexStatus === "failed" ? "解析失败" : document.indexStatus === "unsupported" ? "暂不支持" : document.indexStatus === "processing" ? "解析中" : "未解析"}</span>{document.documentId && (document.indexStatus === "pending" || document.indexStatus === "failed") && <button type="button" onClick={() => void indexDocument(document)} disabled={busy} className="shrink-0 rounded border border-[#d9ddd9] px-2 py-1 text-caption text-[#606560] disabled:opacity-45">{busy ? "解析中…" : document.indexStatus === "failed" ? "重新解析" : "开始解析"}</button>}</div>)}</div></div>}</div> : <div className="mt-3"><p className="mb-2 text-control text-[#777c78]">尚未连接。粘贴一个飞书知识库或目录地址，首次同步后会建立索引。</p><div className="flex gap-2"><input value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} placeholder="https://你的企业.feishu.cn/wiki/..." className="h-9 min-w-0 flex-1 rounded-md border border-[#deddd7] bg-white px-3 text-control outline-none focus:border-[#9eaaa3]" /><button type="button" onClick={() => void connect()} disabled={!url.trim() || busy} className="h-9 rounded-md bg-[#30342f] px-3 text-control font-medium text-white disabled:opacity-45">{busy ? "连接并同步中…" : "连接并首次同步"}</button></div></div>}
    {error && <p role="alert" className="mt-2 text-control leading-5 text-[#955c4c]">{error}</p>}
    {notice && <p role="status" className="mt-2 text-control text-[#547264]">✓ {notice}</p>}
  </section>;
}
