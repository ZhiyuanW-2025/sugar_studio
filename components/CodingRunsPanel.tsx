"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CodingRunView, EngineeringTaskView } from "../lib/coding-runs/types";

function verificationName(command: string) {
  if (/\b(typecheck|tsc)\b/i.test(command)) return "typecheck";
  if (/\blint\b/i.test(command)) return "lint";
  if (/\bbuild\b/i.test(command)) return "build";
  if (/\b(test|pytest|vitest|jest)\b/i.test(command)) return "测试";
  return "检查";
}

function compactStatus(run: CodingRunView) {
  const fileStatus = `修改了 ${run.changedFiles.length} 个文件`;
  const names = [...new Set(run.testResult.commands.map((item) => verificationName(item.command)))];
  const verificationStatus = run.testResult.status === "passed"
    ? `${names.length ? names.join("、") : "检查"} 通过`
    : run.testResult.status === "failed"
      ? `${names.length ? names.join("、") : "检查"} 失败`
      : "未运行检查";
  const saveStatus = run.commitSha ? "已本地保存" : "尚未本地保存";
  return `${fileStatus} · ${verificationStatus} · ${saveStatus}`;
}

function CompletedRun({
  task,
}: {
  task: EngineeringTaskView;
}) {
  const [diffOpen, setDiffOpen] = useState(false);
  const run = task.run!;

  return (
    <div className="mb-5 ml-7 border-t border-[#ecebe7] pt-3">
      <p className={`text-control ${run.testResult.status === "failed" ? "text-[#98584b]" : "text-[#77766f]"}`}>
        {compactStatus(run)}
      </p>
      <div className="mt-2 flex items-center gap-3">
        {run.gitDiff && (
          <button type="button" onClick={() => setDiffOpen((value) => !value)} className="inline-flex h-7 items-center rounded-md border border-[#d5ddd8] bg-white px-2.5 text-control font-medium text-[#3f6b5a] hover:bg-[#f7f8f6]">
            {diffOpen ? "收起代码改动" : "查看代码改动"}
          </button>
        )}
      </div>
      {diffOpen && run.gitDiff && (
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-[#deddd7] bg-[#252522] p-3 font-mono text-caption leading-4 text-[#e7e7e2]">
          {run.gitDiff}
        </pre>
      )}
    </div>
  );
}

export function CodingRunsPanel({
  projectId,
  refreshKey,
  latestAgentMessage,
  onLatestRunChange,
}: {
  projectId: string | null;
  refreshKey: number;
  latestAgentMessage?: string;
  onLatestRunChange: (run: CodingRunView | null) => void;
}) {
  const [tasks, setTasks] = useState<EngineeringTaskView[]>([]);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!projectId) {
      setTasks([]);
      return;
    }
    try {
      const response = await fetch(`/api/coding-runs?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { tasks?: EngineeringTaskView[]; error?: string } | null;
      if (!response.ok || !payload?.tasks) throw new Error(payload?.error || "暂时无法读取工程执行状态。");
      setTasks(payload.tasks);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法读取工程执行状态。");
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const refresh = () => { void load(); };
    window.addEventListener("sugar:coding-runs-changed", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("sugar:coding-runs-changed", refresh);
    };
  }, [load, refreshKey]);

  const latestRun = useMemo(() => tasks.find((task) => task.run)?.run ?? null, [tasks]);
  useEffect(() => { onLatestRunChange(latestRun); }, [latestRun, onLatestRunChange]);

  const visibleTask = useMemo(() => {
    const reply = latestAgentMessage?.trim();
    if (!reply) return null;
    return tasks.find((task) => task.run?.implementationSummary?.trim() === reply) ?? null;
  }, [latestAgentMessage, tasks]);

  if (!visibleTask?.run) return error
    ? <div role="alert" className="mb-4 ml-7 text-control leading-5 text-[#895c49]">{error}</div>
    : null;

  return (
    <>
      {error && <div role="alert" className="mb-3 ml-7 text-control leading-5 text-[#895c49]">{error}</div>}
      <CompletedRun
        task={visibleTask}
      />
    </>
  );
}
