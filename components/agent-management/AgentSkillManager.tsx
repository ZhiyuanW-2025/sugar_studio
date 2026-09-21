"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentDefinition } from "../../lib/agents/catalog";
import { agentSkillToolOptions } from "../../lib/agents/skill-catalog";
import type { AgentTestProject } from "./AgentTestPanel";
import { MarkdownMessage } from "../MarkdownMessage";

type SkillVersion = {
  id: string; version: number; name: string; description: string; triggerDescription: string;
  negativeTriggers: string; instructions: string; outputRequirements: string; allowedTools: string[];
  referenceMaterial: string; testCases: { shouldTrigger: string[]; shouldNotTrigger: string[] };
  isActive: boolean; creatorName: string; createdAt: string;
};
type Skill = { id: string; slug: string; status: "draft" | "active" | "disabled"; activeVersion: SkillVersion; versions: SkillVersion[]; updatedAt: string };
type Form = Omit<SkillVersion, "id" | "version" | "isActive" | "creatorName" | "createdAt"> & { slug: string; status: Skill["status"] };

const emptyForm: Form = {
  slug: "", status: "draft", name: "", description: "", triggerDescription: "", negativeTriggers: "",
  instructions: "", outputRequirements: "", allowedTools: [], referenceMaterial: "",
  testCases: { shouldTrigger: [], shouldNotTrigger: [] },
};
const statusLabels = { draft: "草稿", active: "已启用", disabled: "已停用" };
const rows = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
const text = (value: string[]) => value.join("\n");
const formForSkill = (skill: Skill): Form => {
  const version = skill.activeVersion;
  return { slug: skill.slug, status: skill.status, name: version.name, description: version.description, triggerDescription: version.triggerDescription, negativeTriggers: version.negativeTriggers, instructions: version.instructions, outputRequirements: version.outputRequirements, allowedTools: version.allowedTools, referenceMaterial: version.referenceMaterial, testCases: version.testCases };
};

export function AgentSkillManager({ agent, projects }: { agent: AgentDefinition; projects: AgentTestProject[] }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedId, setSelectedId] = useState<string>("new");
  const [form, setForm] = useState<Form>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [testProjectId, setTestProjectId] = useState(projects[0]?.id ?? "");
  const [testMessage, setTestMessage] = useState("");
  const [testResult, setTestResult] = useState<{ reply: string; skills?: { loaded: string[] } }>();
  const selected = skills.find((skill) => skill.id === selectedId);
  const toolOptions = agentSkillToolOptions[agent.type];

  const load = async (keepId?: string) => {
    setLoading(true);
    const response = await fetch(`/api/agents/skills?agentType=${agent.type}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { skills?: Skill[]; error?: string } | null;
    setLoading(false);
    if (!response.ok || !payload?.skills) { setError(payload?.error || "暂时无法读取 Skills。"); return; }
    setSkills(payload.skills);
    const targetId = keepId && payload.skills.some((skill) => skill.id === keepId) ? keepId : payload.skills[0]?.id ?? "new";
    setSelectedId(targetId);
    const target = payload.skills.find((skill) => skill.id === targetId);
    setForm(target ? formForSkill(target) : emptyForm);
    setTestMessage(target?.activeVersion.testCases.shouldTrigger[0] ?? "");
    setTestResult(undefined);
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeout);
    // Loading remote state is keyed only by the current Agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.type]);

  const chooseSkill = (skill: Skill) => {
    setSelectedId(skill.id);
    setForm(formForSkill(skill));
    setTestMessage(skill.activeVersion.testCases.shouldTrigger[0] ?? "");
    setTestResult(undefined);
  };

  const createNew = () => {
    setSelectedId("new");
    setForm(emptyForm);
    setTestMessage("");
    setTestResult(undefined);
  };

  const dirtyPayload = useMemo(() => ({
    agentType: agent.type, name: form.name, description: form.description, triggerDescription: form.triggerDescription,
    negativeTriggers: form.negativeTriggers, instructions: form.instructions, outputRequirements: form.outputRequirements,
    allowedTools: form.allowedTools, referenceMaterial: form.referenceMaterial, testCases: form.testCases, status: form.status,
  }), [agent.type, form]);

  const save = async () => {
    if (saving || !form.name.trim() || !form.description.trim() || !form.triggerDescription.trim() || !form.instructions.trim()) return;
    setSaving(true); setError(undefined);
    const creating = selectedId === "new";
    const response = await fetch(creating ? "/api/agents/skills" : `/api/agents/skills/${selectedId}`, {
      method: creating ? "POST" : "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creating ? { ...dirtyPayload, slug: form.slug } : { ...dirtyPayload, action: "save" }),
    });
    const payload = await response.json().catch(() => null) as { skill_id?: string; error?: string } | null;
    setSaving(false);
    if (!response.ok) { setError(payload?.error || "保存 Skill 失败。"); return; }
    setNotice(creating ? "Skill 已创建" : "已保存为新的 Skill 版本");
    window.setTimeout(() => setNotice(undefined), 2200);
    await load(creating ? payload?.skill_id : selectedId);
  };

  const setStatus = async (status: Skill["status"]) => {
    if (!selected || saving) return;
    setSaving(true); setError(undefined);
    const response = await fetch(`/api/agents/skills/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentType: agent.type, action: "status", status }) });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    setSaving(false);
    if (!response.ok) { setError(payload?.error || "更新状态失败。"); return; }
    setNotice(status === "active" ? "Skill 已启用" : status === "disabled" ? "Skill 已停用" : "已改为草稿");
    await load(selected.id);
  };

  const rollback = async (version: number) => {
    if (!selected || saving || !window.confirm(`回滚到 v${version} 的内容？系统会创建一个新版本。`)) return;
    setSaving(true); setError(undefined);
    const response = await fetch(`/api/agents/skills/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentType: agent.type, action: "rollback", version }) });
    setSaving(false);
    if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: string } | null; setError(payload?.error || "回滚失败。"); return; }
    setNotice(`已恢复 v${version} 的内容并创建新版本`); await load(selected.id);
  };

  const remove = async () => {
    if (!selected || selected.status !== "draft" || !window.confirm(`删除 Skill 草稿“${selected.activeVersion.name}”？`)) return;
    const response = await fetch(`/api/agents/skills/${selected.id}?agentType=${agent.type}`, { method: "DELETE" });
    if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: string } | null; setError(payload?.error || "删除失败。"); return; }
    setNotice("Skill 草稿已删除"); await load();
  };

  const runTest = async () => {
    if (!selected || !testProjectId || !testMessage.trim() || saving) return;
    setSaving(true); setError(undefined); setTestResult(undefined);
    const response = await fetch("/api/agents/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentType: agent.type, projectId: testProjectId, message: testMessage.trim() }) });
    const payload = await response.json().catch(() => null) as { reply?: string; skills?: { loaded: string[] }; error?: string } | null;
    setSaving(false);
    if (!response.ok || !payload?.reply) { setError(payload?.error || "Skill 测试失败。"); return; }
    setTestResult({ reply: payload.reply, skills: payload.skills });
  };

  return <div>
    <div className="flex items-start justify-between gap-5">
      <div><h2 className="text-panel-title font-semibold">Agent Skills</h2><p className="mt-1 text-body text-[#898880]">把可复用工作方法独立于提示词管理；仅在任务匹配时按需加载。</p></div>
      <button type="button" onClick={createNew} className="h-9 rounded-[7px] bg-[#243f34] px-4 text-body font-medium text-white">＋ 新建 Skill</button>
    </div>
    <div className="mt-4 rounded-[7px] border border-[#dde5e0] bg-[#f3f7f5] px-3.5 py-3 text-body leading-5 text-[#53675c]">Skill 是工作室全局配置，修改后会影响所有项目中的 {agent.name}。Skill 只能使用 Agent 已有工具，不能获得新权限。</div>
    {error && <p role="alert" className="mt-3 text-body text-[#98584b]">{error}</p>}
    <div className="mt-6 grid grid-cols-[240px_minmax(0,1fr)] gap-6">
      <aside className="space-y-2">
        {loading ? <p className="text-body text-[#999890]">正在读取 Skills…</p> : skills.length === 0 && selectedId !== "new" ? <p className="text-body text-[#999890]">这个 Agent 还没有 Skill。</p> : null}
        {skills.map((skill) => <button key={skill.id} type="button" onClick={() => chooseSkill(skill)} className={`w-full rounded-[7px] border px-3 py-3 text-left ${selectedId === skill.id ? "border-[#9bad9f] bg-[#f2f6f3]" : "border-[#e5e4df] bg-white hover:border-[#cecec7]"}`}><span className="block text-body font-medium text-[#44443f]">{skill.activeVersion.name}</span><span className="mt-1 flex justify-between text-caption text-[#929189]"><span>{statusLabels[skill.status]}</span><span>v{skill.activeVersion.version}</span></span></button>)}
        {selectedId === "new" && <div className="rounded-[7px] border border-dashed border-[#9bad9f] bg-[#f7faf8] px-3 py-3 text-body font-medium text-[#4f6c5f]">新 Skill</div>}
      </aside>
      <div className="min-w-0 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="名称"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：活动营销内容" className="h-9 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body outline-none focus:border-[#879e93]" /></Field>
          <Field label="标识（创建后不可修改）"><input value={form.slug} disabled={selectedId !== "new"} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} placeholder="activity-marketing-content" className="h-9 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 font-mono text-body outline-none focus:border-[#879e93] disabled:bg-[#f3f3ef]" /></Field>
        </div>
        <Field label="一句话用途"><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="h-9 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body outline-none focus:border-[#879e93]" /></Field>
        <Field label="什么时候使用"><textarea rows={3} value={form.triggerDescription} onChange={(event) => setForm({ ...form, triggerDescription: event.target.value })} className="w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-white px-3 py-2.5 text-body leading-6 outline-none focus:border-[#879e93]" /></Field>
        <Field label="什么时候不要使用"><textarea rows={3} value={form.negativeTriggers} onChange={(event) => setForm({ ...form, negativeTriggers: event.target.value })} className="w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-white px-3 py-2.5 text-body leading-6 outline-none focus:border-[#879e93]" /></Field>
        <Field label="工作流程（Markdown）"><textarea rows={12} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} className="w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-white px-3 py-2.5 font-mono text-body leading-6 outline-none focus:border-[#879e93]" /></Field>
        <Field label="输出标准"><textarea rows={6} value={form.outputRequirements} onChange={(event) => setForm({ ...form, outputRequirements: event.target.value })} className="w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-white px-3 py-2.5 text-body leading-6 outline-none focus:border-[#879e93]" /></Field>
        <Field label="允许使用的现有工具"><div className="grid grid-cols-2 gap-2 rounded-[7px] border border-[#deddd7] bg-white p-3">{toolOptions.map((tool) => <label key={tool.value} className="flex items-center gap-2 text-body text-[#55554f]"><input type="checkbox" checked={form.allowedTools.includes(tool.value)} onChange={(event) => setForm({ ...form, allowedTools: event.target.checked ? [...form.allowedTools, tool.value] : form.allowedTools.filter((item) => item !== tool.value) })} />{tool.label}</label>)}</div></Field>
        <Field label="参考资料与原则"><textarea rows={5} value={form.referenceMaterial} onChange={(event) => setForm({ ...form, referenceMaterial: event.target.value })} className="w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-white px-3 py-2.5 text-body leading-6 outline-none focus:border-[#879e93]" /></Field>
        <div className="grid grid-cols-2 gap-4"><Field label="应该触发（每行一个测试问题）"><textarea rows={5} value={text(form.testCases.shouldTrigger)} onChange={(event) => setForm({ ...form, testCases: { ...form.testCases, shouldTrigger: rows(event.target.value) } })} className="w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-white px-3 py-2.5 text-body leading-6 outline-none focus:border-[#879e93]" /></Field><Field label="不应该触发（每行一个测试问题）"><textarea rows={5} value={text(form.testCases.shouldNotTrigger)} onChange={(event) => setForm({ ...form, testCases: { ...form.testCases, shouldNotTrigger: rows(event.target.value) } })} className="w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-white px-3 py-2.5 text-body leading-6 outline-none focus:border-[#879e93]" /></Field></div>
        <div className="flex items-center gap-2 border-t border-[#e5e4df] pt-4">
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Form["status"] })} className="h-9 rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body"><option value="draft">保存为草稿</option><option value="active">保存并启用</option><option value="disabled">保存并停用</option></select>
          <button type="button" disabled={saving} onClick={() => void save()} className="h-9 rounded-[7px] bg-[#243f34] px-4 text-body font-medium text-white disabled:opacity-50">{saving ? "正在保存…" : selectedId === "new" ? "创建 Skill" : "保存为新版本"}</button>
          {selected && <><button type="button" disabled={saving} onClick={() => void setStatus(selected.status === "active" ? "disabled" : "active")} className="h-9 rounded-[7px] border border-[#d8d7d1] px-3 text-body">{selected.status === "active" ? "停用" : "启用"}</button>{selected.status === "draft" && <button type="button" onClick={() => void remove()} className="ml-auto text-body text-[#9a5f53]">删除草稿</button>}</>}
        </div>
        {selected && <section className="border-t border-[#e5e4df] pt-5"><h3 className="text-body font-semibold">版本历史</h3><div className="mt-2 divide-y divide-[#e8e7e2] border-y border-[#e8e7e2]">{selected.versions.map((version) => <div key={version.id} className="flex items-center gap-3 py-3 text-body"><span className="w-10 font-mono">v{version.version}</span><span className="flex-1 text-[#929189]">{version.creatorName} · {new Date(version.createdAt).toLocaleString("zh-CN")}</span>{version.isActive ? <span className="text-[#3f6b5a]">当前版本</span> : <button type="button" onClick={() => void rollback(version.version)} className="text-[#596d63]">回滚到此版本</button>}</div>)}</div></section>}
        {selected && projects.length > 0 && <section className="border-t border-[#e5e4df] pt-5"><h3 className="text-body font-semibold">测试触发</h3><p className="mt-1 text-control text-[#929189]">真实运行一次 Agent，检查它是否按需加载此 Skill；不会写入正式会话。</p><div className="mt-3 grid grid-cols-[180px_1fr_auto] gap-2"><select value={testProjectId} onChange={(event) => setTestProjectId(event.target.value)} className="h-9 rounded-[6px] border border-[#d8d7d1] bg-white px-2 text-body">{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><input value={testMessage} onChange={(event) => setTestMessage(event.target.value)} placeholder="输入测试问题" className="h-9 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body outline-none focus:border-[#879e93]" /><button type="button" disabled={saving || !testMessage.trim()} onClick={() => void runTest()} className="h-9 rounded-[7px] border border-[#9bad9f] px-4 text-body text-[#365c4c] disabled:opacity-40">运行测试</button></div>{testResult && <div className="mt-3 rounded-[7px] border border-[#e2e1dc] bg-white p-3 text-body"><p className={testResult.skills?.loaded.includes(selected.slug) ? "text-[#3f6b5a]" : "text-[#9a655c]"}>{testResult.skills?.loaded.includes(selected.slug) ? `✓ 已加载 ${selected.slug}` : `未加载 ${selected.slug}`}</p><MarkdownMessage content={testResult.reply} className="mt-2 text-[#55554f]" /></div>}</section>}
      </div>
    </div>
    {notice && <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-[7px] bg-[#243f34] px-4 py-2.5 text-body font-medium text-white shadow-lg">✓ {notice}</div>}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-control font-medium text-[#77766f]">{label}</span>{children}</label>;
}
