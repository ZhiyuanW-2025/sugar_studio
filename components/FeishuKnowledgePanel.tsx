"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ScopeType = "company" | "project";
type ScopeRow = {
  id: string;
  scope_type: ScopeType;
  project_id: string | null;
  source_url: string;
  display_name: string;
  sync_frequency: "manual" | "weekly";
  last_incremental_sync_at: string | null;
  last_full_sync_at: string | null;
  next_full_sync_at: string;
  last_sync_status: "pending" | "syncing" | "ready" | "failed";
  last_sync_error: string | null;
};

type StatusPayload = {
  configuration: { configured: boolean; hasAppId: boolean; hasAppSecret: boolean };
};

export function FeishuKnowledgePanel({
  scopeType,
  projectId = null,
  onNotice,
}: {
  scopeType: ScopeType;
  projectId?: string | null;
  onNotice: (message: string) => void;
}) {
  const [configuration, setConfiguration] = useState<StatusPayload["configuration"]>();
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [url, setUrl] = useState("");
  const [weekly, setWeekly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [progress, setProgress] = useState<string>();
  const [resolvedName, setResolvedName] = useState<string>();
  const [error, setError] = useState<string>();

  const query = useMemo(() => projectId ? `?projectId=${encodeURIComponent(projectId)}` : "", [projectId]);
  const load = useCallback(async () => {
    const [statusResponse, scopesResponse] = await Promise.all([
      fetch("/api/knowledge/feishu/status", { cache: "no-store" }),
      fetch(`/api/knowledge/feishu/scopes${query}`, { cache: "no-store" }),
    ]);
    const status = await statusResponse.json().catch(() => null) as StatusPayload & { error?: string } | null;
    const scopePayload = await scopesResponse.json().catch(() => null) as { scopes?: ScopeRow[]; error?: string } | null;
    if (!statusResponse.ok || !status?.configuration) throw new Error(status?.error || "暂时无法读取飞书连接状态。");
    if (!scopesResponse.ok || !scopePayload?.scopes) throw new Error(scopePayload?.error || "暂时无法读取飞书知识范围。");
    setConfiguration(status.configuration);
    setScopes(scopePayload.scopes.filter((item) => item.scope_type === scopeType && (scopeType === "company" || item.project_id === projectId)));
  }, [projectId, query, scopeType]);

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

  const validate = async () => {
    if (!url.trim() || testing) return;
    setTesting(true); setError(undefined); setResolvedName(undefined);
    try {
      const response = await fetch("/api/knowledge/feishu/scopes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: url.trim(), scopeType, projectId, validateOnly: true }),
      });
      const payload = await response.json().catch(() => null) as { resolved?: { displayName?: string }; error?: string } | null;
      if (!response.ok || !payload?.resolved) throw new Error(payload?.error || "飞书连接测试失败。");
      setResolvedName(payload.resolved.displayName || "飞书知识库");
      onNotice("飞书地址和访问权限验证成功");
    } catch (value) { setError(value instanceof Error ? value.message : "飞书连接测试失败。"); }
    finally { setTesting(false); }
  };

  const sync = async (scopeId: string, initial = false) => {
    if (busyId) return;
    setBusyId(scopeId); setError(undefined); setProgress("正在读取飞书目录和版本信息…");
    try {
      const response = await fetch("/api/knowledge/feishu/sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopeId, force: initial }),
      });
      const payload = await response.json().catch(() => null) as { total?: number; synced?: number; failed?: number; documentIds?: string[]; error?: string } | null;
      if (!response.ok || typeof payload?.total !== "number") throw new Error(payload?.error || "飞书知识同步失败。");
      if ((payload.failed ?? 0) > 0) throw new Error(`有 ${payload.failed} 份飞书资料同步失败，请检查应用权限或稍后重试。`);
      for (let index = 0; index < (payload.documentIds ?? []).length; index += 1) {
        setProgress(`正在建立知识索引 ${index + 1}/${payload.documentIds!.length}…`);
        const indexResponse = await fetch(`/api/knowledge/documents/${payload.documentIds![index]}/index`, { method: "POST" });
        if (!indexResponse.ok) throw new Error("飞书文件已同步，但部分知识索引建立失败，可在文件列表中重试。");
      }
      onNotice(`飞书同步完成：检查 ${payload.total} 个节点，更新 ${payload.synced ?? 0} 份文档`);
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : "飞书知识同步失败。"); }
    finally { setBusyId(undefined); setProgress(undefined); }
  };

  const save = async () => {
    if (!url.trim() || saving) return;
    setSaving(true); setError(undefined);
    try {
      const response = await fetch("/api/knowledge/feishu/scopes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: url.trim(), scopeType, projectId, syncFrequency: weekly ? "weekly" : "manual" }),
      });
      const payload = await response.json().catch(() => null) as { scope?: { id: string }; error?: string } | null;
      if (!response.ok || !payload?.scope) throw new Error(payload?.error || "暂时无法保存飞书知识范围。");
      setUrl(""); setResolvedName(undefined);
      await load();
      onNotice("飞书知识范围已保存，正在首次同步");
      await sync(payload.scope.id, true);
    } catch (value) { setError(value instanceof Error ? value.message : "暂时无法保存飞书知识范围。"); }
    finally { setSaving(false); }
  };

  const disable = async (scope: ScopeRow) => {
    if (busyId || !window.confirm(`停止同步「${scope.display_name}」？飞书原文不会被删除。`)) return;
    setBusyId(scope.id); setError(undefined);
    try {
      const response = await fetch(`/api/knowledge/feishu/scopes/${scope.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { disabled?: boolean; error?: string } | null;
      if (!response.ok || !payload?.disabled) throw new Error(payload?.error || "暂时无法停止同步。");
      onNotice("已停止该飞书目录的同步，飞书原文未受影响");
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : "暂时无法停止同步。"); }
    finally { setBusyId(undefined); }
  };

  if (loading) return <div className="mb-4 rounded-[8px] border border-[#e7e6e1] px-3 py-3 text-control text-[#999890]"><span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#71877c]" />正在读取飞书连接…</div>;

  return (
    <section className="mb-5 rounded-[8px] border border-[#dfe5e1] bg-[#f8faf8] p-3.5">
      <div className="flex items-start gap-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] bg-[#3370ff] text-body font-semibold text-white">飞</div>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-[#393a36]">飞书{scopeType === "company" ? "共享资料" : "项目材料"}</p>
          <p className="mt-1 text-caption leading-4 text-[#7c817d]">飞书保存正式版本，Sugar Agent 从 Supabase 镜像中快速检索</p>
        </div>
      </div>

      {!configuration?.configured ? (
        <div className="mt-3 rounded-md bg-white px-3 py-2.5 text-caption leading-5 text-[#77766f]">服务端尚未配置飞书 App ID 与 App Secret。</div>
      ) : (
        <>
          <div className="mt-3 rounded-md border border-[#e1e5e2] bg-white p-2.5">
            <label className="block text-caption font-medium text-[#666b67]">飞书知识库或目录地址
              <input value={url} onChange={(event) => { setUrl(event.target.value); setResolvedName(undefined); }} disabled={saving || testing} placeholder="https://你的企业.feishu.cn/wiki/..." className="mt-1.5 h-8 w-full rounded-md border border-[#deddd7] px-2 text-caption outline-none focus:border-[#9eaaa3]" />
            </label>
            <label className="mt-2 flex items-center gap-2 text-caption text-[#777c78]"><input type="checkbox" checked={weekly} onChange={(event) => setWeekly(event.target.checked)} disabled={saving} />每周自动完整对账；飞书变更事件仍会触发增量同步</label>
            {resolvedName && <p className="mt-2 text-caption text-[#547264]">✓ 已验证：{resolvedName}</p>}
            <div className="mt-2 flex gap-1.5">
              <button type="button" onClick={() => void validate()} disabled={!url.trim() || testing || saving} className="h-7 rounded-md border border-[#d9ddd9] px-2.5 text-caption text-[#606560] disabled:opacity-45">{testing ? "验证中…" : "测试连接"}</button>
              <button type="button" onClick={() => void save()} disabled={!url.trim() || testing || saving} className="h-7 rounded-md bg-[#30342f] px-2.5 text-caption font-medium text-white disabled:opacity-45">{saving ? "连接中…" : "连接并首次同步"}</button>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {scopes.map((scope) => (
              <article key={scope.id} className="rounded-md border border-[#e2e5e2] bg-white px-2.5 py-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-caption font-medium text-[#555b57]">{scope.display_name}</p>
                    <p className="mt-0.5 text-micro text-[#999d99]">{scope.last_full_sync_at ? `上次完整同步：${new Date(scope.last_full_sync_at).toLocaleString("zh-CN")}` : "等待首次同步"} · {scope.sync_frequency === "weekly" ? "每周对账" : "仅手动"}</p>
                    {scope.last_sync_error && <p className="mt-1 text-micro text-[#98584b]">{scope.last_sync_error}</p>}
                  </div>
                  <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${scope.last_sync_status === "ready" ? "bg-[#6f8d7e]" : scope.last_sync_status === "failed" ? "bg-[#b77767]" : "animate-pulse bg-[#c1a66f]"}`} />
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button type="button" onClick={() => void sync(scope.id)} disabled={Boolean(busyId)} className="h-6 rounded border border-[#dedfdc] px-2 text-micro text-[#666b67] disabled:opacity-45">{busyId === scope.id ? progress || "同步中…" : "立即同步"}</button>
                  <a href={scope.source_url} target="_blank" rel="noreferrer" className="grid h-6 place-items-center rounded border border-[#dedfdc] px-2 text-micro text-[#66748a]">在飞书查看 ↗</a>
                  <button type="button" onClick={() => void disable(scope)} disabled={Boolean(busyId)} className="h-6 px-1.5 text-micro text-[#a08a82] disabled:opacity-45">停止同步</button>
                </div>
              </article>
            ))}
            {scopes.length === 0 && <p className="py-1 text-caption text-[#a09f98]">尚未连接{scopeType === "company" ? "公司" : "当前项目"}飞书目录。</p>}
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-caption leading-4 text-[#955c4c]">{error}</p>}
    </section>
  );
}
