"use client";

import { useCallback, useEffect, useState } from "react";

type DriveScope = {
  id: string;
  project_id: string;
  source_url: string;
  display_name: string;
  sync_frequency: "manual" | "weekly";
  last_sync_at: string | null;
  last_sync_status: "pending" | "syncing" | "ready" | "failed";
  last_sync_error: string | null;
};

export function FeishuDrivePanel({ projectId, onNotice }: { projectId: string; onNotice: (message: string) => void }) {
  const [scopes, setScopes] = useState<DriveScope[]>([]);
  const [url, setUrl] = useState("");
  const [weekly, setWeekly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [resolved, setResolved] = useState<{ displayName: string; childFolderNames: string[]; childCount: number }>();

  const load = useCallback(async () => {
    const response = await fetch(`/api/knowledge/feishu-drive/scopes?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { scopes?: DriveScope[]; error?: string } | null;
    if (!response.ok || !payload?.scopes) throw new Error(payload?.error || "暂时无法读取项目云盘。");
    setScopes(payload.scopes);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    const loadInitial = async () => {
      try {
        await load();
      } catch (value) {
        if (!cancelled) setError(value instanceof Error ? value.message : "加载失败。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadInitial();
    return () => { cancelled = true; };
  }, [load]);

  const requestScope = async (validateOnly: boolean) => {
    const response = await fetch("/api/knowledge/feishu-drive/scopes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, sourceUrl: url.trim(), validateOnly, syncFrequency: weekly ? "weekly" : "manual" }),
    });
    const payload = await response.json().catch(() => null) as { resolved?: typeof resolved; scope?: DriveScope; error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || "飞书云盘连接失败。");
    return payload;
  };

  const validate = async () => {
    if (!url.trim() || busy) return;
    setBusy("validate"); setError(undefined); setResolved(undefined);
    try {
      const payload = await requestScope(true);
      if (!payload?.resolved) throw new Error("飞书没有返回文件夹信息。");
      setResolved(payload.resolved);
      onNotice("云盘文件夹和访问权限验证成功");
    } catch (value) { setError(value instanceof Error ? value.message : "验证失败。"); }
    finally { setBusy(undefined); }
  };

  const sync = async (scopeId: string) => {
    if (busy) return;
    setBusy(scopeId); setError(undefined);
    try {
      const response = await fetch("/api/knowledge/feishu-drive/sync", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, scopeId }),
      });
      const payload = await response.json().catch(() => null) as { total?: number; folders?: number; indexed?: number; metadataOnly?: number; childFolderNames?: string[]; error?: string } | null;
      if (!response.ok || typeof payload?.total !== "number") throw new Error(payload?.error || "云盘同步失败。");
      onNotice(`云盘索引完成：${payload.folders ?? 0} 个文件夹，${payload.total - (payload.folders ?? 0)} 个媒体文件`);
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : "云盘同步失败。"); }
    finally { setBusy(undefined); }
  };

  const connect = async () => {
    if (!url.trim() || busy) return;
    setBusy("connect"); setError(undefined);
    try {
      const payload = await requestScope(false);
      if (!payload?.scope) throw new Error("暂时无法保存云盘连接。");
      setUrl(""); setResolved(undefined);
      await load();
      onNotice("项目云盘已连接，正在建立媒体知识索引");
      setBusy(undefined);
      await sync(payload.scope.id);
    } catch (value) { setError(value instanceof Error ? value.message : "云盘连接失败。"); setBusy(undefined); }
  };

  const disable = async (scope: DriveScope) => {
    if (busy || !window.confirm(`停止同步「${scope.display_name}」？飞书中的文件不会被删除。`)) return;
    setBusy(scope.id); setError(undefined);
    try {
      const response = await fetch(`/api/knowledge/feishu-drive/scopes/${scope.id}?projectId=${encodeURIComponent(projectId)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { disabled?: boolean; error?: string } | null;
      if (!response.ok || !payload?.disabled) throw new Error(payload?.error || "停止同步失败。");
      await load(); onNotice("已停止该项目云盘的同步");
    } catch (value) { setError(value instanceof Error ? value.message : "停止同步失败。"); }
    finally { setBusy(undefined); }
  };

  if (loading) return <div className="mb-4 rounded-[8px] border border-[#e7e6e1] px-3 py-3 text-control text-[#999890]"><span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#71877c]" />正在读取飞书云盘…</div>;

  return <section className="mb-5 rounded-[8px] border border-[#e4e2dc] bg-[#faf9f6] p-3.5">
    <div className="flex items-start gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] bg-[#5a6b82] text-control font-semibold text-white">盘</div><div><p className="text-body font-semibold text-[#393a36]">飞书云盘</p><p className="mt-1 text-caption leading-4 text-[#7c817d]">图片、音频和视频原件留在飞书；Sugar Agent 只保存目录与内容索引</p></div></div>
    <div className="mt-3 rounded-md border border-[#e1e0da] bg-white p-2.5">
      <label className="block text-caption font-medium text-[#666b67]">当前项目的飞书云盘文件夹地址<input value={url} onChange={(event) => { setUrl(event.target.value); setResolved(undefined); }} disabled={Boolean(busy)} placeholder="打开具体项目文件夹后复制 /drive/folder/… 地址" className="mt-1.5 h-8 w-full rounded-md border border-[#deddd7] px-2 text-caption outline-none focus:border-[#9eaaa3]" /></label>
      <p className="mt-1.5 text-micro leading-4 text-[#999890]">共享云盘首页不能区分项目，必须粘贴当前项目子文件夹的地址。</p>
      <label className="mt-2 flex items-center gap-2 text-caption text-[#777c78]"><input type="checkbox" checked={weekly} onChange={(event) => setWeekly(event.target.checked)} disabled={Boolean(busy)} />每周自动刷新媒体索引</label>
      {resolved && <div className="mt-2 rounded bg-[#f4f8f5] px-2 py-1.5 text-caption leading-4 text-[#547264]">✓ 已验证：{resolved.displayName} · {resolved.childCount} 个直接子项{resolved.childFolderNames.length ? <><br />子文件夹：{resolved.childFolderNames.join("、")}</> : null}</div>}
      <div className="mt-2 flex gap-1.5"><button type="button" onClick={() => void validate()} disabled={!url.trim() || Boolean(busy)} className="h-7 rounded-md border border-[#d9ddd9] px-2.5 text-caption text-[#606560] disabled:opacity-45">{busy === "validate" ? "验证中…" : "测试连接"}</button><button type="button" onClick={() => void connect()} disabled={!url.trim() || Boolean(busy)} className="h-7 rounded-md bg-[#30342f] px-2.5 text-caption font-medium text-white disabled:opacity-45">{busy === "connect" ? "连接中…" : "连接并建立索引"}</button></div>
    </div>
    <div className="mt-3 space-y-2">{scopes.map((scope) => <article key={scope.id} className="rounded-md border border-[#e2e1dc] bg-white px-2.5 py-2"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="truncate text-caption font-medium text-[#555b57]">{scope.display_name}</p><p className="mt-0.5 text-micro text-[#999d99]">{scope.last_sync_at ? `上次索引：${new Date(scope.last_sync_at).toLocaleString("zh-CN")}` : "等待首次索引"} · {scope.sync_frequency === "weekly" ? "每周刷新" : "仅手动"}</p>{scope.last_sync_error && <p className="mt-1 text-micro text-[#98584b]">{scope.last_sync_error}</p>}</div><span title={scope.last_sync_status} className={`mt-0.5 h-1.5 w-1.5 rounded-full ${scope.last_sync_status === "ready" ? "bg-[#6f8d7e]" : scope.last_sync_status === "failed" ? "bg-[#b77767]" : "animate-pulse bg-[#c1a66f]"}`} /></div><div className="mt-2 flex gap-1.5"><button type="button" onClick={() => void sync(scope.id)} disabled={Boolean(busy)} className="h-6 rounded border border-[#dedfdc] px-2 text-micro text-[#666b67] disabled:opacity-45">{busy === scope.id ? "正在读取并理解媒体…" : "立即同步"}</button><a href={scope.source_url} target="_blank" rel="noreferrer" className="grid h-6 place-items-center rounded border border-[#dedfdc] px-2 text-micro text-[#66748a]">打开云盘 ↗</a><button type="button" onClick={() => void disable(scope)} disabled={Boolean(busy)} className="h-6 px-1.5 text-micro text-[#a08a82] disabled:opacity-45">停止同步</button></div></article>)}</div>
    {scopes.length === 0 && <p className="mt-3 text-caption text-[#a09f98]">尚未给当前项目绑定飞书云盘。</p>}
    {error && <p role="alert" className="mt-2 text-caption leading-4 text-[#955c4c]">{error}</p>}
  </section>;
}
