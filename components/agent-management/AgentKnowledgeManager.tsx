"use client";

import { useEffect, useState } from "react";
import type { AgentDefinition } from "../../lib/agents/catalog";
import { AgentFeishuKnowledgeManager } from "./AgentFeishuKnowledgeManager";

type Knowledge = { id: string; title: string; content: string; status: "active" | "disabled"; updated_at: string };
type KnowledgeDraft = { id: string; title: string; content: string; status: "active" | "disabled" };
const emptyKnowledge: KnowledgeDraft = { id: "", title: "", content: "", status: "active" };

export function AgentKnowledgeManager({ agent }: { agent: AgentDefinition }) {
  const [items, setItems] = useState<Knowledge[]>([]);
  const [selected, setSelected] = useState<KnowledgeDraft>(emptyKnowledge);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const load = async () => { setLoading(true); const response = await fetch(`/api/agents/knowledge?agentType=${agent.type}`, { cache: "no-store" }); const payload = await response.json().catch(() => null) as { knowledge?: Knowledge[]; error?: string } | null; setLoading(false); if (!response.ok || !payload?.knowledge) { setError(payload?.error || "暂时无法读取 Agent 通用知识。"); return; } setItems(payload.knowledge); setSelected((current) => current.id ? payload.knowledge!.find((item) => item.id === current.id) ?? emptyKnowledge : payload.knowledge![0] ?? emptyKnowledge); };
  useEffect(() => {
    // Loading remote knowledge state is the synchronization owned by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.type]);
  const save = async () => { if (!selected.title.trim() || !selected.content.trim() || saving) return; setSaving(true); setError(undefined); const response = await fetch("/api/agents/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentType: agent.type, ...selected }) }); const payload = await response.json().catch(() => null) as { error?: string } | null; setSaving(false); if (!response.ok) { setError(payload?.error || "保存通用知识失败。"); return; } setNotice("Agent 通用知识已保存"); window.setTimeout(() => setNotice(undefined), 2200); await load(); };
  const remove = async () => { if (!selected.id || saving) return; setSaving(true); const response = await fetch("/api/agents/knowledge", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id }) }); setSaving(false); if (!response.ok) { setError("删除通用知识失败。"); return; } setSelected(emptyKnowledge); await load(); };

  return <div>
    <div className="flex items-end justify-between"><div><h2 className="text-panel-title font-semibold">知识</h2><p className="mt-1 text-body text-[#898880]">项目和公司知识提供事实；Agent 通用知识提供完成工作的规则与方法。</p></div></div>
    <section className="mt-6"><h3 className="text-body font-semibold text-[#55554f]">项目与公司知识</h3><p className="mt-1 text-control text-[#929189]">这些内容来自当前项目、工作室资料和已连接的知识库，由项目材料页维护。</p><div className="mt-3 divide-y divide-[#e8e7e2] border-y border-[#e8e7e2]">{agent.knowledge.map((item) => <div key={item.label} className="flex items-center justify-between py-3 text-body"><span className="text-[#55554f]">{item.label}</span><span className={item.status === "enabled" ? "text-[#3f6b5a]" : "text-[#aaa9a1]"}>{item.status === "enabled" ? "可供 Agent 使用" : "尚未接入"}</span></div>)}</div></section>
    <AgentFeishuKnowledgeManager agent={agent} />
    <section className="mt-10 border-t border-[#e5e4df] pt-7"><div className="flex items-end justify-between"><div><h3 className="text-body font-semibold text-[#55554f]">Agent 通用知识</h3><p className="mt-1 text-control text-[#929189]">例如代码规范、小红书写作要领、采购比较原则。修改后会影响所有项目中的 {agent.name}。</p></div><button type="button" onClick={() => setSelected({ ...emptyKnowledge })} className="h-9 rounded-[7px] bg-[#243f34] px-4 text-body font-medium text-white">＋ 新增知识</button></div>
      {error && <p role="alert" className="mt-3 text-body text-[#98584b]">{error}</p>}
      <div className="mt-5 grid grid-cols-[230px_minmax(0,1fr)] gap-6"><aside className="space-y-2">{loading ? <p className="text-body text-[#999890]">正在读取通用知识…</p> : items.map((item) => <button key={item.id} type="button" onClick={() => setSelected(item)} className={`w-full rounded-[7px] border px-3 py-3 text-left ${selected.id === item.id ? "border-[#9bad9f] bg-[#f2f6f3]" : "border-[#e5e4df] bg-white"}`}><span className="block truncate text-body font-medium text-[#44443f]">{item.title}</span><span className="mt-1 block text-caption text-[#929189]">{item.status === "active" ? "已启用" : "已停用"}</span></button>)}</aside><div className="space-y-4"><label className="block"><span className="mb-2 block text-control font-medium text-[#77766f]">知识名称</span><input value={selected.title} onChange={(event) => setSelected({ ...selected, title: event.target.value })} placeholder="例如：小红书写作要领" className="h-9 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body" /></label><label className="block"><span className="mb-2 block text-control font-medium text-[#77766f]">知识内容</span><textarea rows={15} value={selected.content} onChange={(event) => setSelected({ ...selected, content: event.target.value })} placeholder="写清楚 Agent 应该如何完成工作、哪些情况不要做。" className="w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-white px-3 py-2.5 text-body leading-6" /></label><div className="flex items-center gap-2 border-t border-[#e5e4df] pt-4"><select value={selected.status} onChange={(event) => setSelected({ ...selected, status: event.target.value as Knowledge["status"] })} className="h-9 rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body"><option value="active">启用</option><option value="disabled">停用</option></select><button type="button" disabled={saving || !selected.title.trim() || !selected.content.trim()} onClick={() => void save()} className="h-9 rounded-[7px] bg-[#243f34] px-4 text-body font-medium text-white disabled:opacity-50">{saving ? "正在保存…" : "保存知识"}</button>{selected.id && <button type="button" disabled={saving} onClick={() => void remove()} className="ml-auto text-body text-[#9a5f53]">删除</button>}</div></div></div>
    </section>
    {notice && <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-[7px] bg-[#243f34] px-4 py-2.5 text-body font-medium text-white shadow-lg">✓ {notice}</div>}
  </div>;
}
