"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentDefinition } from "../../lib/agents/catalog";
import {
  agentTestKnowledgeSources,
  maxAgentTestVersions,
  type AgentTestCase,
  type AgentTestCatalog,
  type AgentTestRun,
  type AgentTestVersion,
} from "../../lib/agents/test-workbench";
import { insertTextareaNewline } from "../../lib/ui/textarea-keyboard";
import { MarkdownMessage } from "../MarkdownMessage";

export type AgentTestProject = { id: string; name: string };
type WorkspaceResponse = { cases?: AgentTestCase[]; catalog?: AgentTestCatalog; error?: string };

const versionLetter = (index: number) => String.fromCharCode(65 + index);
const formatTime = (value: string) => new Intl.DateTimeFormat("zh-CN", {
  month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));

export function AgentTestPanel({ agent, projects }: { agent: AgentDefinition; projects: AgentTestProject[] }) {
  const [cases, setCases] = useState<AgentTestCase[]>([]);
  const [catalog, setCatalog] = useState<AgentTestCatalog>({
    models: [],
    skills: [],
    prompt: { instructions: "", source: "fallback", version: null },
  });
  const [activeId, setActiveId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [scoringResultId, setScoringResultId] = useState<string>();

  const activeCase = useMemo(() => cases.find((item) => item.id === activeId), [cases, activeId]);

  const loadWorkspace = useCallback(async (preferredId?: string) => {
    const response = await fetch(`/api/agents/tests?agentType=${agent.type}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as WorkspaceResponse | null;
    if (!response.ok || !payload?.cases || !payload.catalog) throw new Error(payload?.error || "暂时无法读取测试案例。");
    setCases(payload.cases);
    setCatalog(payload.catalog);
    setActiveId((current) => {
      const candidate = preferredId ?? current;
      return payload.cases?.some((item) => item.id === candidate) ? candidate : payload.cases?.[0]?.id;
    });
    return payload.cases;
  }, [agent.type]);

  useEffect(() => {
    let cancelled = false;
    // Loading persisted test state is the external synchronization owned by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWorkspace()
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "暂时无法读取测试案例。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadWorkspace]);

  const updateCase = (updater: (current: AgentTestCase) => AgentTestCase) => {
    if (!activeId) return;
    setCases((current) => current.map((item) => item.id === activeId ? updater(item) : item));
    setNotice(undefined);
  };

  const createTest = async () => {
    if (!projects[0] || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch("/api/agents/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentType: agent.type, projectId: projects[0].id }),
      });
      const payload = await response.json().catch(() => null) as { id?: string; error?: string } | null;
      if (!response.ok || !payload?.id) throw new Error(payload?.error || "新建测试失败。");
      await loadWorkspace(payload.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "新建测试失败。");
    } finally {
      setSaving(false);
    }
  };

  const saveTest = async (showNotice = true) => {
    if (!activeCase) throw new Error("请先新建测试。");
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch("/api/agents/tests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeCase.id,
          projectId: activeCase.projectId,
          title: activeCase.title,
          prompt: activeCase.prompt,
          versions: activeCase.versions,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "保存测试配置失败。");
      const refreshed = await loadWorkspace(activeCase.id);
      if (showNotice) setNotice("测试配置已保存");
      return refreshed.find((item) => item.id === activeCase.id);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (!activeCase?.prompt.trim() || running || saving) return;
    setRunning(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const saved = await saveTest(false);
      if (!saved) throw new Error("保存测试配置失败。");
      const response = await fetch(`/api/agents/tests/${saved.id}/run`, { method: "POST" });
      const payload = await response.json().catch(() => null) as { run?: AgentTestRun; error?: string } | null;
      if (!response.ok || !payload?.run) throw new Error(payload?.error || "运行测试失败。");
      setCases((current) => current.map((item) => item.id === saved.id
        ? { ...item, latestRun: payload.run!, updatedAt: payload.run!.completedAt ?? item.updatedAt }
        : item));
      setNotice("所有测试版本已完成");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "运行测试失败。");
    } finally {
      setRunning(false);
    }
  };

  const deleteTest = async () => {
    if (!activeCase || !window.confirm(`删除测试“${activeCase.title}”？历史运行结果也会一并删除。`)) return;
    setSaving(true);
    const response = await fetch(`/api/agents/tests?id=${activeCase.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    setSaving(false);
    if (!response.ok) { setError(payload?.error || "删除测试失败。"); return; }
    await loadWorkspace();
  };

  const addVersion = () => {
    if (!activeCase || activeCase.versions.length >= maxAgentTestVersions) return;
    updateCase((current) => {
      const source = current.versions.at(-1);
      const position = current.versions.length;
      const version: AgentTestVersion = {
        id: `new-${crypto.randomUUID()}`,
        name: `版本 ${versionLetter(position)}`,
        position,
        modelConfigId: source?.modelConfigId ?? null,
        promptOverride: source?.promptOverride ?? null,
        knowledgeSources: [...(source?.knowledgeSources ?? agentTestKnowledgeSources.map((item) => item.value))],
        skillSlugs: [...(source?.skillSlugs ?? [])],
      };
      return { ...current, versions: [...current.versions, version] };
    });
  };

  const updateVersion = (id: string, updater: (version: AgentTestVersion) => AgentTestVersion) => {
    updateCase((current) => ({ ...current, versions: current.versions.map((version) => version.id === id ? updater(version) : version) }));
  };

  const scoreResult = async (resultId: string, score: number) => {
    if (!activeCase?.latestRun || scoringResultId) return;
    setScoringResultId(resultId);
    setError(undefined);
    try {
      const response = await fetch(`/api/agents/tests/${activeCase.id}/results/${resultId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score }),
      });
      const payload = await response.json().catch(() => null) as { score?: number; scoredAt?: string; error?: string } | null;
      if (!response.ok || !payload?.score || !payload.scoredAt) throw new Error(payload?.error || "保存评分失败。");
      setCases((current) => current.map((testCase) => testCase.id !== activeCase.id || !testCase.latestRun ? testCase : {
        ...testCase,
        latestRun: {
          ...testCase.latestRun,
          results: testCase.latestRun.results.map((result) => result.id === resultId
            ? { ...result, score: payload.score!, scoredAt: payload.scoredAt! }
            : result),
        },
      }));
    } catch (scoreError) {
      setError(scoreError instanceof Error ? scoreError.message : "保存评分失败。");
    } finally {
      setScoringResultId(undefined);
    }
  };

  if (!projects.length) return <p className="text-body text-[#8f6a5f]">你当前没有可用于测试的项目。</p>;

  return (
    <div className="min-h-[680px]">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-panel-title font-semibold">Agent 对比测试</h2>
          <p className="mt-1 text-body text-[#898880]">用同一条提示词对比不同模型、知识与 Skill。测试为只读，不会执行写飞书、改代码或询价等动作。</p>
        </div>
        <button type="button" onClick={() => void createTest()} disabled={saving} className="shrink-0 rounded-[7px] bg-[#243f34] px-4 py-2 text-body font-medium text-white disabled:opacity-50">＋ 新建测试</button>
      </div>

      {error && <p role="alert" className="mt-4 rounded-[7px] bg-[#fff4ef] px-4 py-3 text-body text-[#98584b]">{error}</p>}
      {notice && <p className="mt-4 rounded-[7px] bg-[#eff6f1] px-4 py-3 text-body text-[#426c58]">{notice}</p>}

      <div className="mt-5 grid grid-cols-[230px_minmax(0,1fr)] gap-5">
        <aside className="border-r border-[#e2e1db] pr-4">
          <p className="mb-2 text-control font-medium text-[#929188]">之前的测试</p>
          {loading ? <p className="py-3 text-body text-[#aaa9a2]">正在读取…</p> : cases.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-[#d8d7d1] px-3 py-5 text-center text-control leading-5 text-[#999890]">还没有测试案例<br />点击右上角开始</div>
          ) : (
            <div className="space-y-1.5">
              {cases.map((testCase) => (
                <button key={testCase.id} type="button" onClick={() => { setActiveId(testCase.id); setError(undefined); setNotice(undefined); }} className={`w-full rounded-[7px] px-3 py-2.5 text-left transition ${activeId === testCase.id ? "bg-[#edf2ee] text-[#294a3b]" : "text-[#66655f] hover:bg-[#f4f4f1]"}`}>
                  <span className="block truncate text-body font-medium">{testCase.title}</span>
                  <span className="mt-1 block truncate text-caption text-[#9b9a93]">{testCase.projectName} · {formatTime(testCase.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="min-w-0">
          {!activeCase ? (
            <div className="flex min-h-[460px] items-center justify-center rounded-[10px] border border-dashed border-[#d8d7d1] text-body text-[#999890]">新建或选择一个测试案例</div>
          ) : (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_220px_auto] items-end gap-3">
                <label className="block text-control font-medium text-[#85847c]">测试名称
                  <input value={activeCase.title} onChange={(event) => updateCase((current) => ({ ...current, title: event.target.value }))} className="mt-1.5 h-10 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body outline-none focus:border-[#80988c]" />
                </label>
                <label className="block text-control font-medium text-[#85847c]">测试项目
                  <select value={activeCase.projectId} onChange={(event) => updateCase((current) => ({ ...current, projectId: event.target.value, projectName: projects.find((project) => project.id === event.target.value)?.name ?? current.projectName }))} className="mt-1.5 h-10 w-full rounded-[7px] border border-[#d8d7d1] bg-white px-3 text-body outline-none">
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => void deleteTest()} className="h-10 px-2 text-control text-[#9c6e63] hover:text-[#7d4d43]">删除</button>
              </div>

              <div className="mt-6 flex items-center justify-between">
                <div><h3 className="text-body font-semibold text-[#4b4a45]">测试版本</h3><p className="mt-0.5 text-control text-[#999890]">最多 {maxAgentTestVersions} 个版本；每次运行会同时开始。</p></div>
                <button type="button" disabled={activeCase.versions.length >= maxAgentTestVersions} onClick={addVersion} className="rounded-[7px] border border-[#cfcfc8] bg-white px-3 py-2 text-control font-medium text-[#536b60] disabled:opacity-40">＋ 添加测试版本</button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
                {activeCase.versions.map((version, index) => (
                  <VersionCard
                    key={version.id}
                    version={version}
                    index={index}
                    catalog={catalog}
                    canDelete={activeCase.versions.length > 1}
                    onChange={(updater) => updateVersion(version.id, updater)}
                    onDelete={() => updateCase((current) => ({ ...current, versions: current.versions.filter((item) => item.id !== version.id).map((item, position) => ({ ...item, position })) }))}
                  />
                ))}
              </div>

              <label className="mt-6 block text-body font-semibold text-[#4b4a45]">本次测试提示词
                <textarea
                  value={activeCase.prompt}
                  onChange={(event) => updateCase((current) => ({ ...current, prompt: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !event.altKey) return;
                    event.preventDefault();
                    event.stopPropagation();
                    insertTextareaNewline(event.currentTarget, activeCase.prompt, (value) => updateCase((current) => ({ ...current, prompt: value })));
                  }}
                  rows={5}
                  placeholder="输入一条所有测试版本共同执行的提示词…"
                  className="mt-2 w-full resize-y rounded-[8px] border border-[#d8d7d1] bg-white px-4 py-3 text-body leading-6 outline-none focus:border-[#80988c]"
                />
              </label>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-caption text-[#aaa9a1]">Option/Alt + Enter 换行</span>
                <div className="flex gap-2">
                  <button type="button" disabled={saving || running} onClick={() => void saveTest().catch((saveError) => setError(saveError instanceof Error ? saveError.message : "保存失败。"))} className="rounded-[7px] border border-[#cfcfc8] bg-white px-4 py-2 text-body text-[#5f5e58] disabled:opacity-50">{saving && !running ? "保存中…" : "保存配置"}</button>
                  <button type="button" disabled={saving || running || !activeCase.prompt.trim()} onClick={() => void runTest()} className="rounded-[7px] bg-[#243f34] px-5 py-2 text-body font-medium text-white disabled:opacity-50">{running ? `正在同时运行 ${activeCase.versions.length} 个版本…` : `开始测试（${activeCase.versions.length} 个版本）`}</button>
                </div>
              </div>

              {activeCase.latestRun && <RunResults run={activeCase.latestRun} scoringResultId={scoringResultId} onScore={scoreResult} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function VersionCard({ version, index, catalog, canDelete, onChange, onDelete }: {
  version: AgentTestVersion;
  index: number;
  catalog: AgentTestCatalog;
  canDelete: boolean;
  onChange: (updater: (version: AgentTestVersion) => AgentTestVersion) => void;
  onDelete: () => void;
}) {
  return (
    <section className="rounded-[9px] border border-[#deddd7] bg-[#fbfbf9] p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e8eee9] text-caption font-semibold text-[#476353]">{versionLetter(index)}</span>
        <input value={version.name} onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))} className="min-w-0 flex-1 border-0 bg-transparent text-body font-semibold text-[#464640] outline-none" />
        {canDelete && <button type="button" onClick={onDelete} aria-label={`删除${version.name}`} className="text-lg text-[#aaa9a2] hover:text-[#8a5e54]">×</button>}
      </div>
      <label className="mt-4 block text-control text-[#85847c]">模型
        <select value={version.modelConfigId ?? ""} onChange={(event) => onChange((current) => ({ ...current, modelConfigId: event.target.value || null }))} className="mt-1.5 h-9 w-full rounded-[6px] border border-[#d8d7d1] bg-white px-2.5 text-control outline-none">
          <option value="">使用当前 Agent 默认模型</option>
          {catalog.models.map((model) => <option key={model.id} value={model.id}>{model.provider} · {model.model}{model.isDefault ? "（用户默认）" : ""}</option>)}
        </select>
      </label>
      <div className="mt-4 border-t border-[#e7e6e1] pt-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-control text-[#85847c]">Agent 提示词</p>
            <p className="mt-0.5 text-caption text-[#999890]">{version.promptOverride === null ? `使用当前线上 Prompt${catalog.prompt.version ? ` v${catalog.prompt.version}` : ""}` : "使用此版本的自定义 Prompt"}</p>
          </div>
          <button
            type="button"
            onClick={() => onChange((current) => ({ ...current, promptOverride: current.promptOverride === null ? catalog.prompt.instructions : null }))}
            className="shrink-0 rounded-[6px] border border-[#cfcec8] bg-white px-2.5 py-1.5 text-caption font-medium text-[#526b5f]"
          >
            {version.promptOverride === null ? "修改提示词" : "恢复线上版本"}
          </button>
        </div>
        {version.promptOverride !== null && (
          <textarea
            value={version.promptOverride}
            onChange={(event) => onChange((current) => ({ ...current, promptOverride: event.target.value }))}
            rows={9}
            placeholder="输入这个测试版本使用的 Agent 系统提示词…"
            className="mt-2.5 w-full resize-y rounded-[6px] border border-[#d8d7d1] bg-white px-3 py-2.5 font-mono text-caption leading-5 text-[#4d4d47] outline-none focus:border-[#80988c]"
          />
        )}
      </div>
      <fieldset className="mt-4">
        <legend className="text-control text-[#85847c]">连接知识</legend>
        <div className="mt-2 space-y-2">
          {agentTestKnowledgeSources.map((source) => {
            const checked = version.knowledgeSources.includes(source.value);
            return <label key={source.value} className="flex cursor-pointer items-start gap-2.5 text-control text-[#585852]">
              <input type="checkbox" checked={checked} onChange={() => onChange((current) => ({ ...current, knowledgeSources: checked ? current.knowledgeSources.filter((item) => item !== source.value) : [...current.knowledgeSources, source.value] }))} className="mt-0.5 accent-[#426c58]" />
              <span><span className="block font-medium">{source.label}</span><span className="mt-0.5 block text-caption text-[#999890]">{source.description}</span></span>
            </label>;
          })}
        </div>
      </fieldset>
      <fieldset className="mt-4 border-t border-[#e7e6e1] pt-3">
        <legend className="px-1 text-control text-[#85847c]">使用 Skills</legend>
        {catalog.skills.length === 0 ? <p className="mt-1 text-caption text-[#aaa9a2]">这个 Agent 还没有启用的 Skill</p> : (
          <div className="mt-1 space-y-2">
            {catalog.skills.map((skill) => {
              const checked = version.skillSlugs.includes(skill.slug);
              return <label key={skill.slug} className="flex cursor-pointer gap-2.5 text-control text-[#585852]">
                <input type="checkbox" checked={checked} onChange={() => onChange((current) => ({ ...current, skillSlugs: checked ? current.skillSlugs.filter((slug) => slug !== skill.slug) : [...current.skillSlugs, skill.slug] }))} className="mt-0.5 accent-[#426c58]" />
                <span><span className="font-medium">{skill.name}</span><span className="ml-1 text-caption text-[#aaa9a2]">v{skill.version}</span></span>
              </label>;
            })}
          </div>
        )}
      </fieldset>
    </section>
  );
}

function RunResults({ run, scoringResultId, onScore }: {
  run: AgentTestRun;
  scoringResultId?: string;
  onScore: (resultId: string, score: number) => Promise<void>;
}) {
  return (
    <section className="mt-8 border-t border-[#deddd7] pt-6">
      <div className="flex items-end justify-between">
        <div><h3 className="text-panel-title font-semibold">最近一次测试结果</h3><p className="mt-1 text-control text-[#999890]">{formatTime(run.startedAt)} · 同一提示词并行运行</p></div>
        <span className={`rounded-full px-2.5 py-1 text-caption ${run.status === "failed" ? "bg-[#fff0eb] text-[#995d4f]" : "bg-[#edf5ef] text-[#4a725d]"}`}>{run.status === "failed" ? "全部失败" : "已完成"}</span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        {run.results.map((result) => (
          <article key={result.id} className="min-w-0 rounded-[9px] border border-[#deddd7] bg-white p-4">
            <div className="flex items-start justify-between gap-3 border-b border-[#ecebe6] pb-3">
              <div><h4 className="text-body font-semibold text-[#44443f]">{result.versionName}</h4><p className="mt-1 text-caption text-[#999890]">{result.model ? `${result.modelProvider} · ${result.model}` : "模型未启动"} · {result.durationMs ? `${(result.durationMs / 1000).toFixed(1)} 秒` : "—"}</p></div>
              <span className={`text-caption ${result.status === "failed" ? "text-[#98584b]" : "text-[#4f765f]"}`}>{result.status === "failed" ? "失败" : "完成"}</span>
            </div>
            {result.reply ? <MarkdownMessage content={result.reply} className="mt-4 text-body leading-7 text-[#45453f]" /> : <p className="mt-4 text-body text-[#98584b]">{result.error}</p>}
            <div className="mt-5 border-t border-[#ecebe6] pt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-control font-medium text-[#62615b]">给这个结果打分 <span className="font-normal text-[#999890]">1–10，越高越好</span></p>
                {result.score && <span className="text-control font-semibold text-[#3f6b58]">{result.score} 分</span>}
              </div>
              <div className="mt-2 grid grid-cols-10 gap-1">
                {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
                  <button
                    key={score}
                    type="button"
                    aria-label={`给${result.versionName}打${score}分`}
                    aria-pressed={result.score === score}
                    disabled={scoringResultId === result.id}
                    onClick={() => void onScore(result.id, score)}
                    className={`h-8 rounded-[5px] border text-control font-medium transition disabled:opacity-50 ${result.score === score ? "border-[#426c58] bg-[#426c58] text-white" : "border-[#d8d7d1] bg-white text-[#696862] hover:border-[#80988c] hover:text-[#315444]"}`}
                  >{score}</button>
                ))}
              </div>
              {result.scoredAt && <p className="mt-1.5 text-right text-caption text-[#aaa9a2]">评分已记录 · {formatTime(result.scoredAt)}</p>}
            </div>
            <div className="mt-5 space-y-1.5 rounded-[6px] bg-[#f6f6f3] px-3 py-2.5 text-caption text-[#77766f]">
              <p>工具：{result.toolCalls.length ? result.toolCalls.join("、") : "未调用"}</p>
              <p>Skills：{result.loadedSkills.length ? result.loadedSkills.join("、") : "未使用"}</p>
              <p>Prompt：{result.promptSource === "test_override" ? "本测试版本自定义" : result.promptVersion ? `v${result.promptVersion}` : result.promptSource ?? "—"}</p>
              {result.traceId && <p className="truncate font-mono" title={result.traceId}>Trace：{result.traceId}</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
