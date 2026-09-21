"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PlanVersion = {
  id: string;
  version: number;
  content: string;
  changeSummary: string;
  creatorName: string;
  sourceThreadId: string | null;
  createdAt: string;
  isCurrent: boolean;
};

type BrainData = {
  project: { id: string; name: string; description: string; status: string; updatedAt: string };
  snapshot: { summary: string; currentPlanSummary: string; currentStage: string; currentPlanVersionId: string | null; updatedAt: string };
  artifact: { id: string; title: string; currentVersionId: string | null } | null;
  versions: PlanVersion[];
};

type Props = { projectId: string; onNotice: (message: string) => void };

const readPayload = (response: Response) => response.json().catch(() => null) as Promise<(BrainData & { error?: string }) | { ok?: boolean; error?: string } | null>;

function lineDiff(left: string, right: string) {
  const leftLines = new Set(left.split("\n").map((line) => line.trim()).filter(Boolean));
  const rightLines = new Set(right.split("\n").map((line) => line.trim()).filter(Boolean));
  return {
    removed: [...leftLines].filter((line) => !rightLines.has(line)),
    added: [...rightLines].filter((line) => !leftLines.has(line)),
  };
}

export function ProjectBrainPanel({ projectId, onNotice }: Props) {
  const [data, setData] = useState<BrainData | null>(null);
  const [tab, setTab] = useState<"current" | "versions" | "compare">("current");
  const [summary, setSummary] = useState("");
  const [stage, setStage] = useState("");
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [leftVersionId, setLeftVersionId] = useState("");
  const [rightVersionId, setRightVersionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/projects/${projectId}/brain`, { cache: "no-store" });
    const payload = await readPayload(response);
    setLoading(false);
    if (!response.ok || !payload || !("snapshot" in payload)) {
      setError(payload?.error || "项目大脑加载失败。");
      return;
    }
    setData(payload);
    setSummary(payload.snapshot.summary);
    setStage(payload.snapshot.currentStage);
    setLeftVersionId(payload.versions[1]?.id || payload.versions[0]?.id || "");
    setRightVersionId(payload.versions[0]?.id || "");
  }, [projectId]);

  useEffect(() => {
    // The effect owns synchronization with the selected project's remote brain state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const compared = useMemo(() => {
    const left = data?.versions.find((version) => version.id === leftVersionId);
    const right = data?.versions.find((version) => version.id === rightVersionId);
    return left && right ? { left, right, ...lineDiff(left.content, right.content) } : null;
  }, [data, leftVersionId, rightVersionId]);

  const saveContext = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/brain`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, currentStage: stage }),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload || !("ok" in payload) || !payload.ok) throw new Error(payload?.error || "项目概况更新失败。");
      onNotice("项目正式概况已更新");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "项目概况更新失败。");
    } finally { setBusy(false); }
  };

  const rollback = async (version: PlanVersion) => {
    if (busy || version.isCurrent || !window.confirm(`确认回滚到 v${version.version}？系统会保留全部历史，并创建一个新的正式版本。`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/brain/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: version.id }),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload || !("ok" in payload) || !payload.ok) throw new Error(payload?.error || "方案回滚失败。");
      onNotice(`已回滚到 v${version.version}，并创建新的正式版本`);
      await load();
    } catch (rollbackError) {
      setError(rollbackError instanceof Error ? rollbackError.message : "方案回滚失败。");
    } finally { setBusy(false); }
  };

  if (loading) return <p role="status" className="py-4 text-control text-[#999890]"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#557267]" />正在读取项目正式状态…</p>;
  if (!data) return <p role="alert" className="py-4 text-control text-[#895c49]">{error || "项目大脑加载失败。"}</p>;

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-[7px] bg-[#f0f0ec] p-1">
        {([['current', '当前状态'], ['versions', `版本 ${data.versions.length}`], ['compare', '版本对比']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`h-7 rounded-[5px] text-caption font-medium ${tab === id ? "bg-white text-[#34342f] shadow-sm" : "text-[#88877f]"}`}>{label}</button>
        ))}
      </div>

      {tab === "current" && (
        <div>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-[8px] bg-[#f0f0ec] text-body font-semibold text-[#5f5e58]">{Array.from(data.project.name).slice(0, 1)}</span>
            <div><p className="text-body font-medium text-[#33332f]">{data.project.name}</p><p className="mt-0.5 text-caption text-[#999890]">{data.project.status === "archived" ? "已归档" : "进行中"}</p></div>
          </div>
          {data.project.description && <p className="mt-4 text-control leading-5 text-[#77766f]">{data.project.description}</p>}
          <label className="mt-5 block text-caption font-medium text-[#88877f]">当前阶段
            <input value={stage} maxLength={200} onChange={(event) => setStage(event.target.value)} className="mt-1.5 h-8 w-full rounded-md border border-[#deddd7] px-2.5 text-control outline-none focus:border-[#9aa9a1]" />
          </label>
          <label className="mt-4 block text-caption font-medium text-[#88877f]">正式项目概况
            <textarea value={summary} maxLength={12000} onChange={(event) => setSummary(event.target.value)} rows={5} className="mt-1.5 w-full resize-y rounded-md border border-[#deddd7] px-2.5 py-2 text-control leading-5 outline-none focus:border-[#9aa9a1]" placeholder="记录所有 Agent 应共同遵循的已确认项目事实…" />
          </label>
          <button type="button" aria-busy={busy} onClick={() => void saveContext()} disabled={busy} className="mt-2 h-8 rounded-md border border-[#d7e1dc] bg-[#f5f8f6] px-3 text-control font-medium text-[#416253] disabled:opacity-40">{busy ? "保存中…" : "保存正式概况"}</button>
          <div className="mt-5 border-t border-[#ecebe7] pt-4">
            <div className="flex items-center"><p className="text-caption font-medium uppercase tracking-[0.1em] text-[#999890]">当前正式策划方案</p>{data.versions[0] && <span className="ml-auto text-caption text-[#587165]">v{data.versions.find((version) => version.isCurrent)?.version || data.versions[0].version}</span>}</div>
            {data.snapshot.currentPlanSummary ? <pre className="mt-3 whitespace-pre-wrap font-sans text-control leading-[1.75] text-[#55554f]">{data.snapshot.currentPlanSummary}</pre> : <p className="mt-3 text-control leading-5 text-[#999890]">还没有正式方案。可以请小花整理当前讨论，再从该回复的“更多操作”中保存。</p>}
          </div>
          <p className="mt-5 rounded-[7px] bg-[#f5f7f5] p-3 text-caption leading-4 text-[#718078]">这里是用户确认后的正式状态。聊天和知识库文件不会自动覆盖这些内容。</p>
        </div>
      )}

      {tab === "versions" && (
        <div className="divide-y divide-[#ecebe7] border-y border-[#ecebe7]">
          {data.versions.length === 0 ? <p className="py-5 text-control text-[#999890]">还没有正式方案版本。</p> : data.versions.map((version) => (
            <div key={version.id} className="py-3">
              <button type="button" onClick={() => setExpandedVersion((current) => current === version.id ? null : version.id)} className="flex w-full items-start gap-2 text-left">
                <span className={`mt-0.5 rounded-[5px] px-1.5 py-0.5 text-micro font-medium ${version.isCurrent ? "bg-[#e6efe9] text-[#3f6251]" : "bg-[#f0f0ec] text-[#77766f]"}`}>v{version.version}{version.isCurrent ? " · 当前" : ""}</span>
                <span className="min-w-0 flex-1"><span className="block text-control leading-4 text-[#55554f]">{version.changeSummary}</span><span className="mt-1 block text-micro text-[#aaa9a1]">{version.creatorName} · {new Date(version.createdAt).toLocaleString("zh-CN")}{version.sourceThreadId ? " · 来源：小花对话" : ""}</span></span>
                <span className="text-caption text-[#999890]">{expandedVersion === version.id ? "收起" : "查看"}</span>
              </button>
              {expandedVersion === version.id && <div className="mt-3 rounded-[7px] bg-[#f8f8f5] p-3"><pre className="whitespace-pre-wrap font-sans text-caption leading-[1.7] text-[#66665f]">{version.content}</pre>{!version.isCurrent && <button type="button" aria-busy={busy} disabled={busy} onClick={() => void rollback(version)} className="mt-3 text-caption font-medium text-[#416253] underline underline-offset-2 disabled:opacity-40">{busy ? "正在回滚…" : "回滚到这个版本"}</button>}</div>}
            </div>
          ))}
        </div>
      )}

      {tab === "compare" && (
        <div>
          {data.versions.length < 2 ? <p className="py-5 text-control text-[#999890]">至少保存两个正式版本后才能对比。</p> : <>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-micro font-medium text-[#999890]">较早版本<select value={leftVersionId} onChange={(event) => setLeftVersionId(event.target.value)} className="mt-1 h-8 w-full rounded-md border border-[#deddd7] bg-white px-2 text-caption">{data.versions.map((version) => <option key={version.id} value={version.id}>v{version.version}</option>)}</select></label>
              <label className="text-micro font-medium text-[#999890]">较新版本<select value={rightVersionId} onChange={(event) => setRightVersionId(event.target.value)} className="mt-1 h-8 w-full rounded-md border border-[#deddd7] bg-white px-2 text-caption">{data.versions.map((version) => <option key={version.id} value={version.id}>v{version.version}</option>)}</select></label>
            </div>
            {compared && <div className="mt-4 space-y-4">
              <section><p className="text-caption font-medium text-[#47705b]">新增或调整</p>{compared.added.length ? compared.added.map((line) => <p key={line} className="mt-1.5 border-l-2 border-[#b9d1c2] pl-2 text-caption leading-4 text-[#5b665f]">+ {line}</p>) : <p className="mt-2 text-caption text-[#aaa9a1]">没有检测到新增行。</p>}</section>
              <section><p className="text-caption font-medium text-[#8a655d]">移除或替换</p>{compared.removed.length ? compared.removed.map((line) => <p key={line} className="mt-1.5 border-l-2 border-[#ddc7c0] pl-2 text-caption leading-4 text-[#75635e]">− {line}</p>) : <p className="mt-2 text-caption text-[#aaa9a1]">没有检测到移除行。</p>}</section>
            </div>}
          </>}
        </div>
      )}
      {error && <p role="alert" className="mt-4 rounded-md bg-[#fbf3ef] px-3 py-2 text-control text-[#895c49]">{error}</p>}
    </div>
  );
}
