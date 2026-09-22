"use client";

import { useEffect, useState } from "react";
import type { AgentDefinition } from "../../lib/agents/catalog";

type Tool = { id: string | null; slug: string; name: string; description: string; implementation: string; inputSchema: Record<string, unknown>; status: "enabled" | "disabled"; isBuiltin: boolean };
const emptyTool: Tool = { id: null, slug: "", name: "", description: "", implementation: "", inputSchema: {}, status: "disabled", isBuiltin: false };

export function AgentToolManager({ agent }: { agent: AgentDefinition }) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [selected, setSelected] = useState<Tool>(emptyTool);
  const [schemaText, setSchemaText] = useState("{}");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const selectTool = (tool: Tool) => {
    setSelected(tool);
    setSchemaText(JSON.stringify(tool.inputSchema ?? {}, null, 2));
  };

  const load = async () => {
    setLoading(true);
    const response = await fetch(`/api/agents/tools?agentType=${agent.type}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { tools?: Tool[]; error?: string } | null;
    setLoading(false);
    if (!response.ok || !payload?.tools) { setError(payload?.error || "暂时无法读取工具。"); return; }
    setTools(payload.tools);
    const next = selected.slug ? payload.tools!.find((tool) => tool.slug === selected.slug) ?? payload.tools![0] ?? emptyTool : payload.tools![0] ?? emptyTool;
    selectTool(next);
  };
  useEffect(() => {
    // Loading remote tool state is the synchronization owned by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.type]);

  const save = async () => {
    if (!selected.slug.trim() || !selected.name.trim() || saving) return;
    setSaving(true); setError(undefined);
    let schema: Record<string, unknown>;
    try {
      const parsed = JSON.parse(schemaText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("schema must be an object");
      schema = parsed as Record<string, unknown>;
    } catch { setError("输入结构必须是有效 JSON 对象。"); setSaving(false); return; }
    const response = await fetch("/api/agents/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentType: agent.type, ...selected, inputSchema: schema }) });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    setSaving(false);
    if (!response.ok) { setError(payload?.error || "保存工具失败。"); return; }
    setNotice("工具配置已保存"); window.setTimeout(() => setNotice(undefined), 2200); await load();
  };

  const remove = async () => {
    if (!selected.id || selected.isBuiltin || saving) return;
    setSaving(true);
    const response = await fetch("/api/agents/tools", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id }) });
    setSaving(false);
    if (!response.ok) { setError("删除工具失败。"); return; }
    setNotice("自定义工具已删除"); window.setTimeout(() => setNotice(undefined), 2200); setSelected(emptyTool); await load();
  };

    return <div>
    <div className="flex items-end justify-between"><div><h2 className="text-panel-title font-semibold">工具</h2><p className="mt-1 text-body text-[#898880]">查看和编辑 Agent 的工具说明、输入结构与工作边界。</p></div><button type="button" onClick={() => { const tool = { ...emptyTool, slug: `custom_tool_${Date.now()}` }; setSelected(tool); setSchemaText("{}"); }} className="h-9 rounded-[7px] bg-[#243f34] px-4 text-body font-medium text-white">＋ 新建工具</button></div>
    <div className="mt-4 rounded-[7px] border border-[#dde5e0] bg-[#f3f7f5] px-3.5 py-3 text-body leading-5 text-[#53675c]">已有工具会显示当前服务端工具的构成说明。你可以编辑描述、输入结构和使用边界；实际调用权限仍由服务端代码控制，编辑这里不会自动获得新的服务器权限。</div>
    {error && <p role="alert" className="mt-3 text-body text-[#98584b]">{error}</p>}
    <div className="mt-6 grid grid-cols-[230px_minmax(0,1fr)] gap-6">
      <aside className="space-y-2">{loading ? <p className="text-body text-[#999890]">正在读取工具…</p> : tools.map((tool) => <button key={tool.slug} type="button" onClick={() => selectTool(tool)} className={`w-full rounded-[7px] border px-3 py-3 text-left ${selected.slug === tool.slug ? "border-[#9bad9f] bg-[#f2f6f3]" : "border-[#e5e4df] bg-white hover:border-[#cecec7]"}`}><span className="block truncate text-body font-medium text-[#44443f]">{tool.name}</span><span className="mt-1 block font-mono text-caption text-[#929189]">{tool.slug}</span><span className={`mt-1 block text-caption ${tool.status === "enabled" ? "text-[#3f6b5a]" : "text-[#aaa9a1]"}`}>{tool.status === "enabled" ? "已启用" : "已停用"} · {tool.isBuiltin ? "内置" : "自定义"}</span></button>)}</aside>
      <div className="min-w-0 space-y-4">
        <label className="block"><span className="mb-2 block text-control font-medium text-[#77766f]">工具名称</span><input value={selected.name} onChange={(event) => setSelected({ ...selected, name: event.target.value })} className="h-9 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body outline-none focus:border-[#879e93]" /></label>
        <label className="block"><span className="mb-2 block text-control font-medium text-[#77766f]">标识</span><input value={selected.slug} disabled={selected.isBuiltin} onChange={(event) => setSelected({ ...selected, slug: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} className="h-9 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 font-mono text-body disabled:bg-[#f3f3ef]" /></label>
        <label className="block"><span className="mb-2 block text-control font-medium text-[#77766f]">工具用途与边界</span><textarea rows={4} value={selected.description} onChange={(event) => setSelected({ ...selected, description: event.target.value })} className="w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-white px-3 py-2.5 text-body leading-6" /></label>
        <label className="block"><span className="mb-2 block text-control font-medium text-[#77766f]">工具构成说明</span><textarea rows={8} value={selected.implementation} onChange={(event) => setSelected({ ...selected, implementation: event.target.value })} className="w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-white px-3 py-2.5 font-mono text-body leading-6" /></label>
        <label className="block"><span className="mb-2 block text-control font-medium text-[#77766f]">输入结构（JSON）</span><textarea rows={6} value={schemaText} onChange={(event) => setSchemaText(event.target.value)} className="w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-[#fbfbf9] px-3 py-2.5 font-mono text-body leading-6" /></label>
        <div className="flex items-center gap-2 border-t border-[#e5e4df] pt-4"><select value={selected.status} onChange={(event) => setSelected({ ...selected, status: event.target.value as Tool["status"] })} className="h-9 rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body"><option value="enabled">启用</option><option value="disabled">停用</option></select><button type="button" disabled={saving || !selected.name.trim()} onClick={() => void save()} className="h-9 rounded-[7px] bg-[#243f34] px-4 text-body font-medium text-white disabled:opacity-50">{saving ? "正在保存…" : "保存工具"}</button>{selected.id && !selected.isBuiltin && <button type="button" disabled={saving} onClick={() => void remove()} className="ml-auto text-body text-[#9a5f53]">删除</button>}</div>
      </div>
    </div>
    {notice && <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-[7px] bg-[#243f34] px-4 py-2.5 text-body font-medium text-white shadow-lg">✓ {notice}</div>}
  </div>;
}
