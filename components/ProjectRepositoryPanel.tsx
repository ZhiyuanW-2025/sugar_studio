"use client";

import { useCallback, useEffect, useState } from "react";
import type { RepositoryBinding, RepositoryStatus } from "../lib/git/provider";

type RepositoryResponse = {
  repository?: RepositoryBinding | null;
  sharedRemoteUrl?: string | null;
  status?: RepositoryStatus;
  error?: string;
};

type RunnerDevice = {
  id: string;
  name: string;
  platform: string | null;
  status: "active" | "revoked";
  last_seen_at: string | null;
};

function StatusCard({ status }: { status: RepositoryStatus }) {
  return (
    <div className="space-y-2 rounded-[8px] border border-[#deddd7] bg-white p-3 text-control leading-5 text-[#68675f]">
      <div className="grid grid-cols-[76px_1fr] gap-x-2">
        <span className="text-[#999890]">代码仓库</span><span className="font-medium text-[#41413c]">{status.repositoryName}</span>
        <span className="text-[#999890]">本地路径</span><span className="break-all font-mono text-caption">{status.localRepositoryPath}</span>
        <span className="text-[#999890]">当前分支</span><span className="font-mono text-caption">{status.currentBranch}</span>
        <span className="text-[#999890]">Git 状态</span><span className={status.clean ? "text-[#3f6b5a]" : "text-[#9a6544]"}>{status.clean ? "干净" : `存在 ${status.changes.length} 个未提交文件`}</span>
        <span className="text-[#999890]">Remote</span><span className="break-all">{status.remoteName}{status.remoteUrl ? ` · ${status.remoteUrl}` : " · 未配置"}</span>
        <span className="text-[#999890]">同步状态</span><span>ahead {status.ahead} · behind {status.behind}</span>
      </div>
      {!status.clean && (
        <div className="border-t border-[#ecebe7] pt-2">
          <p className="font-medium text-[#806047]">当前仓库已经存在未提交修改</p>
          <p className="mt-1 break-all font-mono text-caption text-[#77766f]">{status.changes.map((item) => item.path).join(" · ")}</p>
          <p className="mt-1 text-[#999890]">Sugar Agent 不会自动 stash、reset、discard 或 checkout 覆盖。</p>
        </div>
      )}
    </div>
  );
}

export function ProjectRepositoryPanel({ projectId, onNotice }: { projectId: string | null; onNotice: (message: string) => void }) {
  const [repository, setRepository] = useState<RepositoryBinding | null>(null);
  const [status, setStatus] = useState<RepositoryStatus | null>(null);
  const [localRepositoryPath, setLocalRepositoryPath] = useState("");
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [devices, setDevices] = useState<RunnerDevice[]>([]);
  const [runnerDeviceId, setRunnerDeviceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const verify = useCallback(async (silent = false) => {
    if (!projectId) return;
    if (!silent) setBusy("verify");
    setError(undefined);
    try {
      const response = await fetch("/api/projects/repository/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const payload = await response.json().catch(() => null) as RepositoryResponse | null;
      if (!response.ok || !payload?.status) throw new Error(payload?.error || "读取本地仓库状态失败。");
      setStatus(payload.status);
      if (!silent) onNotice("本地 Git 仓库状态已刷新");
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : "读取本地仓库状态失败。");
    } finally {
      if (!silent) setBusy(undefined);
    }
  }, [onNotice, projectId]);

  const load = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [response, deviceResponse] = await Promise.all([
        fetch(`/api/projects/repository?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
        fetch("/api/runner/devices", { cache: "no-store" }),
      ]);
      const [payload, devicePayload] = await Promise.all([
        response.json().catch(() => null) as Promise<RepositoryResponse | null>,
        deviceResponse.json().catch(() => null) as Promise<{ devices?: RunnerDevice[] } | null>,
      ]);
      if (!response.ok) throw new Error(payload?.error || "暂时无法读取仓库配置。");
      const next = payload?.repository ?? null;
      const activeDevices = deviceResponse.ok
        ? (devicePayload?.devices || []).filter((device) => device.status === "active")
        : [];
      setDevices(activeDevices);
      setRunnerDeviceId(next?.runnerDeviceId || activeDevices[0]?.id || "");
      setRepository(next);
      if (next) {
        setLocalRepositoryPath(next.localRepositoryPath);
        setRemoteName(next.remoteName);
        setRemoteUrl(next.remoteUrl || "");
      } else {
        setRemoteUrl(payload?.sharedRemoteUrl || "");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法读取仓库配置。");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!repository?.localRepositoryPath) return;
    const timer = window.setTimeout(() => { void verify(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [repository, verify]);

  const save = async () => {
    if (!projectId || busy) return;
    setBusy("save"); setError(undefined);
    try {
      const response = await fetch("/api/projects/repository", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          repository: { runnerDeviceId: runnerDeviceId || null, localRepositoryPath, remoteName, remoteUrl },
        }),
      });
      const payload = await response.json().catch(() => null) as RepositoryResponse | null;
      if (!response.ok || !payload?.repository || !payload.status) throw new Error(payload?.error || "仓库绑定失败。");
      setRepository(payload.repository);
      setStatus(payload.status);
      onNotice("本地 Git 仓库已验证并绑定");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "仓库绑定失败。");
    } finally { setBusy(undefined); }
  };

  const remoteAction = async (action: "fetch" | "pull") => {
    if (!projectId || !status || busy) return;
    const warning = action === "pull"
      ? `确认从 ${status.remoteName}/${status.currentBranch} Pull？\n\n当前 ahead ${status.ahead}、behind ${status.behind}。Sugar Agent 不会自动解决冲突。`
      : `确认从 remote ${status.remoteName} Fetch？此操作只更新远端引用。`;
    if (!window.confirm(warning)) return;
    setBusy(action); setError(undefined);
    try {
      const response = await fetch("/api/projects/repository/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action, confirmed: true }),
      });
      const payload = await response.json().catch(() => null) as { result?: { status: RepositoryStatus }; error?: string } | null;
      if (!response.ok || !payload?.result) throw new Error(payload?.error || `${action} 失败。`);
      setStatus(payload.result.status);
      onNotice(`${action === "pull" ? "Pull" : "Fetch"} 已完成`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${action} 失败。`);
      await verify(true);
    } finally { setBusy(undefined); }
  };

  const unbind = async () => {
    if (!projectId || !repository || busy) return;
    if (!window.confirm("解除当前项目在这台电脑上的本地仓库绑定？远程 Git 地址不会被删除。")) return;
    setBusy("unbind"); setError(undefined);
    try {
      const response = await fetch(`/api/projects/repository?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "解除仓库绑定失败。");
      setRepository(null);
      setStatus(null);
      setLocalRepositoryPath("");
      onNotice("已解除当前项目的本地仓库绑定");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "解除仓库绑定失败。");
    } finally { setBusy(undefined); }
  };

  if (!projectId) return <p className="text-body leading-5 text-[#999890]">当前演示项目尚未连接数据库。</p>;
  if (loading) return <p role="status" className="text-body text-[#999890]"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#557267]" />正在读取仓库配置…</p>;

  return (
    <div className="space-y-5">
      <div className="rounded-[8px] border border-[#e5e4df] bg-[#fafaf8] p-3 text-control leading-5 text-[#77766f]">
        远程 Git 地址向项目成员共享；本地路径只属于你的工作环境，其他成员看不到。牛牛直接使用你当前 checkout 的分支，不 clone、不自动创建分支。
      </div>
      <div className="space-y-3">
        <label className="block text-control font-medium text-[#77766f]">运行牛牛的电脑
          <select value={runnerDeviceId} onChange={(event) => setRunnerDeviceId(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border border-[#deddd7] bg-white px-3 text-control text-[#33332f] outline-none focus:border-[#999890]">
            {devices.length === 0 && <option value="">尚未配对 Sugar Runner</option>}
            {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
          </select>
          {devices.length === 0 && <span className="mt-1 block text-caption font-normal text-[#9a6544]">请先前往“账户设置 → Sugar Runner”完成设备配对。本地开发的 direct 模式除外。</span>}
        </label>
        <label className="block text-control font-medium text-[#77766f]">远程 Git 地址 <span className="font-normal text-[#aaa9a1]">（项目共享）</span>
          <input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/organization/repository.git" className="mt-1.5 h-9 w-full rounded-md border border-[#deddd7] px-3 font-mono text-control text-[#33332f] outline-none focus:border-[#999890]" />
        </label>
        <label className="block text-control font-medium text-[#77766f]">本地仓库绝对路径
          <input value={localRepositoryPath} onChange={(event) => setLocalRepositoryPath(event.target.value)} placeholder="/Users/name/path/to/repository" className="mt-1.5 h-9 w-full rounded-md border border-[#deddd7] px-3 font-mono text-control text-[#33332f] outline-none focus:border-[#999890]" />
        </label>
        <label className="block text-control font-medium text-[#77766f]">Git Remote 名称 <span className="font-normal text-[#aaa9a1]">（通常是 origin，不是分支名）</span>
          <input value={remoteName} onChange={(event) => setRemoteName(event.target.value)} placeholder="origin" className="mt-1.5 h-9 w-full rounded-md border border-[#deddd7] px-3 font-mono text-body text-[#33332f] outline-none focus:border-[#999890]" />
          <span className="mt-1 block text-caption font-normal text-[#aaa9a1]">当前 checkout 分支由系统自动读取，无需在这里填写。</span>
        </label>
      </div>
      {status && <StatusCard status={status} />}
      {error && <div role="alert" className="rounded-md border border-[#eadfd8] bg-[#fbf5f1] px-3 py-2 text-control leading-5 text-[#895c49]">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-busy={busy === "save"} disabled={!!busy || !localRepositoryPath.trim() || !remoteName.trim() || (devices.length > 0 && !runnerDeviceId)} onClick={save} className="h-8 rounded-md bg-[#252522] px-3 text-control font-medium text-white disabled:opacity-40">{busy === "save" ? "验证中…" : repository ? "更新绑定" : "验证并绑定"}</button>
        {repository && <button type="button" aria-busy={busy === "verify"} disabled={!!busy} onClick={() => void verify()} className="h-8 rounded-md border border-[#deddd7] px-3 text-control font-medium text-[#55554f] disabled:opacity-40">{busy === "verify" ? "刷新中…" : "刷新 Git 状态"}</button>}
        {status?.remoteUrl && <button type="button" aria-busy={busy === "fetch"} disabled={!!busy} onClick={() => void remoteAction("fetch")} className="h-8 rounded-md border border-[#deddd7] px-3 text-control font-medium text-[#55554f] disabled:opacity-40">{busy === "fetch" ? "Fetch 中…" : "确认 Fetch"}</button>}
        {status?.remoteUrl && <button type="button" aria-busy={busy === "pull"} disabled={!!busy || !status.clean} onClick={() => void remoteAction("pull")} className="h-8 rounded-md border border-[#deddd7] px-3 text-control font-medium text-[#55554f] disabled:opacity-40">{busy === "pull" ? "Pull 中…" : "确认 Pull"}</button>}
        {repository && <button type="button" aria-busy={busy === "unbind"} disabled={!!busy} onClick={() => void unbind()} className="h-8 rounded-md border border-[#e4d8d2] px-3 text-control font-medium text-[#925c4e] disabled:opacity-40">{busy === "unbind" ? "解除中…" : "解除本地仓库绑定"}</button>}
      </div>
    </div>
  );
}
