"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type KnowledgeScope = {
  id: string; root_node_token: string | null; source_url: string; display_name: string;
  last_incremental_sync_at: string | null; last_full_sync_at: string | null;
  last_sync_status: string; last_sync_error: string | null; sync_frequency: string;
};
type DriveScope = {
  id: string; folder_token: string; source_url: string; display_name: string;
  last_sync_at: string | null; last_sync_status: string; last_sync_error: string | null; sync_frequency: string;
};
type KnowledgeItem = {
  id: string; sync_scope_id: string; node_token: string; parent_node_token: string | null;
  obj_type: string; title: string; source_url: string | null; external_updated_at: string | null;
  sync_status: string; sync_error: string | null; summary: string; index_status: string;
};
type DriveItem = {
  id: string; scope_id: string; file_token: string; parent_file_token: string | null;
  item_type: "folder" | "image" | "audio" | "video" | "other"; file_name: string;
  source_url: string | null; path_text: string; source_updated_at: string | null;
  content_summary: string; index_status: string; index_error: string | null;
};
type KnowledgeSyncResult = {
  total?: number;
  synced?: number;
  unchanged?: number;
  unsupported?: number;
  failed?: number;
  documentIds?: string[];
  error?: string;
};
export type ProjectMaterialsPayload = {
  lastSyncedAt: string | null;
  knowledgeScopes: KnowledgeScope[];
  driveScopes: DriveScope[];
  knowledgeItems: KnowledgeItem[];
  driveItems: DriveItem[];
};

type TreeNode = {
  key: string; token: string; name: string; kind: string; summary: string;
  updatedAt: string | null; url: string | null; availability: string | null; children: TreeNode[];
};

function dateLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function relativeSync(value: string | null) {
  if (!value) return "尚未同步";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return dateLabel(value);
}

function withLatestChildDate(node: TreeNode): TreeNode {
  const children = node.children.map(withLatestChildDate);
  const timestamps = [node.updatedAt, ...children.map((child) => child.updatedAt)].filter(Boolean) as string[];
  return { ...node, children, updatedAt: timestamps.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null };
}

function buildKnowledgeTree(scope: KnowledgeScope, items: KnowledgeItem[]) {
  const nodes = new Map<string, TreeNode>(items.map((item) => [item.node_token, {
    key: item.id, token: item.node_token, name: item.title, kind: item.obj_type,
    summary: item.summary, updatedAt: item.external_updated_at, url: item.source_url,
    availability: item.sync_status === "unsupported" ? (item.sync_error || "仅保留目录，暂未解析") : item.sync_status === "failed" ? "同步失败" : null,
    children: [],
  } as TreeNode]));
  const roots: TreeNode[] = [];
  for (const item of items) {
    const node = nodes.get(item.node_token)!;
    const parent = item.parent_node_token ? nodes.get(item.parent_node_token) : null;
    if (parent && item.parent_node_token !== scope.root_node_token) parent.children.push(node);
    else roots.push(node);
  }
  return roots.map(withLatestChildDate);
}

function buildDriveTree(scope: DriveScope, items: DriveItem[]) {
  const nodes = new Map<string, TreeNode>(items.map((item) => [item.file_token, {
    key: item.id, token: item.file_token, name: item.file_name, kind: item.item_type,
    summary: item.item_type === "folder" ? item.content_summary : "",
    updatedAt: item.source_updated_at, url: item.source_url, availability: null, children: [],
  } as TreeNode]));
  const roots: TreeNode[] = [];
  for (const item of items) {
    const node = nodes.get(item.file_token)!;
    const parent = item.parent_file_token ? nodes.get(item.parent_file_token) : null;
    if (parent && item.parent_file_token !== scope.folder_token) parent.children.push(node);
    else roots.push(node);
  }
  return roots.map(withLatestChildDate);
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const children = filterTree(node.children, query);
    const matches = `${node.name} ${node.summary}`.toLowerCase().includes(query.toLowerCase());
    return matches || children.length ? [{ ...node, children }] : [];
  });
}

function icon(kind: string) {
  if (kind === "folder") return "▸";
  if (["image"].includes(kind)) return "▧";
  if (["video"].includes(kind)) return "▶";
  if (["audio"].includes(kind)) return "♪";
  if (["sheet", "bitable"].includes(kind)) return "▦";
  return "▤";
}

function MaterialNode({ node, depth = 0, forceOpen = false }: { node: TreeNode; depth?: number; forceOpen?: boolean }) {
  const hasChildren = node.children.length > 0;
  const isFolderLike = node.kind === "folder" || hasChildren;
  const row = (
    <div className="group py-2" style={{ paddingLeft: `${depth * 18}px` }}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={`grid h-5 w-5 shrink-0 place-items-center text-control ${isFolderLike ? "text-[#66746c]" : "text-[#999890]"}`}>{icon(node.kind)}</span>
        {node.url ? <a href={node.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-body font-medium text-[#4b4c47] hover:text-[#2d5f4b] hover:underline">{node.name}</a> : <span className="min-w-0 truncate text-body font-medium text-[#4b4c47]">{node.name}</span>}
        {node.availability && <span title={node.availability} className="max-w-[240px] truncate rounded bg-[#f4eee7] px-1.5 py-0.5 text-micro text-[#8a6754]">{node.availability}</span>}
        {node.updatedAt && <span className="ml-auto shrink-0 text-micro text-[#aaa9a1]">修改于 {dateLabel(node.updatedAt)}</span>}
      </div>
      {node.kind === "folder" && node.summary && <p className="ml-7 mt-1 max-w-[820px] text-caption leading-4 text-[#8b8c85]">{node.summary}</p>}
    </div>
  );
  if (!hasChildren) return row;
  return <details open={forceOpen || depth < 1} className="border-b border-[#f1f0ec] last:border-0"><summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{row}</summary><div>{node.children.map((child) => <MaterialNode key={child.key} node={child} depth={depth + 1} forceOpen={forceOpen} />)}</div></details>;
}

function ConnectionSettings({ projectId, data, onClose, onChanged, onNotice }: {
  projectId: string; data: ProjectMaterialsPayload; onClose: () => void; onChanged: () => Promise<void>; onNotice: (message: string) => void;
}) {
  const [knowledgeUrl, setKnowledgeUrl] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const indexKnowledgeDocuments = async (documentIds: string[]) => {
    for (const documentId of documentIds) {
      const response = await fetch(`/api/knowledge/documents/${documentId}/index`, { method: "POST" });
      if (!response.ok) throw new Error("飞书文档已经同步，但部分内容索引尚未完成，请稍后再次同步。");
    }
  };

  const connect = async (target: "knowledge" | "drive") => {
    const sourceUrl = (target === "knowledge" ? knowledgeUrl : driveUrl).trim();
    if (!sourceUrl || busy) return;
    setBusy(`connect:${target}`); setError(undefined);
    try {
      const endpoint = target === "knowledge" ? "/api/knowledge/feishu/scopes" : "/api/knowledge/feishu-drive/scopes";
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target === "knowledge"
          ? { projectId, sourceUrl, scopeType: "project", syncFrequency: "weekly" }
          : { projectId, sourceUrl, syncFrequency: "weekly" }),
      });
      const payload = await response.json().catch(() => null) as { scope?: { id: string }; error?: string } | null;
      if (!response.ok || !payload?.scope) throw new Error(payload?.error || "连接失败。");
      setBusy(`sync:${target}`);
      const syncResponse = await fetch(target === "knowledge" ? "/api/knowledge/feishu/sync" : "/api/knowledge/feishu-drive/sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target === "knowledge" ? { scopeId: payload.scope.id, force: true } : { projectId, scopeId: payload.scope.id }),
      });
      const syncPayload = await syncResponse.json().catch(() => null) as KnowledgeSyncResult | null;
      if (!syncResponse.ok) throw new Error(syncPayload?.error || "连接已保存，但首次同步失败。");
      if (target === "knowledge" && (syncPayload?.failed ?? 0) > 0) throw new Error(`已读取飞书目录，但有 ${syncPayload?.failed} 份材料同步失败。`);
      if (target === "knowledge" && syncPayload?.documentIds?.length) await indexKnowledgeDocuments(syncPayload.documentIds);
      if (target === "knowledge") setKnowledgeUrl(""); else setDriveUrl("");
      await onChanged();
      onNotice(`${target === "knowledge" ? "飞书知识库" : "飞书云盘"}已连接并完成同步`);
    } catch (value) { setError(value instanceof Error ? value.message : "连接失败。"); }
    finally { setBusy(undefined); }
  };

  const sync = async (target: "knowledge" | "drive", scopeId: string) => {
    if (busy) return;
    setBusy(`sync:${scopeId}`); setError(undefined);
    try {
      const response = await fetch(target === "knowledge" ? "/api/knowledge/feishu/sync" : "/api/knowledge/feishu-drive/sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target === "knowledge" ? { scopeId, force: false } : { projectId, scopeId }),
      });
      const payload = await response.json().catch(() => null) as KnowledgeSyncResult | null;
      if (!response.ok) throw new Error(payload?.error || "同步失败。");
      if (target === "knowledge" && (payload?.failed ?? 0) > 0) throw new Error(`已读取飞书目录，但有 ${payload?.failed} 份材料同步失败。`);
      if (target === "knowledge" && payload?.documentIds?.length) await indexKnowledgeDocuments(payload.documentIds);
      await onChanged();
      if (target === "knowledge") {
        const synced = payload?.synced ?? 0;
        const unchanged = payload?.unchanged ?? 0;
        const unsupported = payload?.unsupported ?? 0;
        onNotice(synced > 0
          ? `飞书知识库已同步：更新 ${synced} 项，未变化 ${unchanged} 项${unsupported ? `，${unsupported} 项暂不支持解析` : ""}`
          : `飞书知识库已检查：没有新变化${unsupported ? `，${unsupported} 项暂不支持解析` : ""}`);
      } else {
        onNotice("飞书云盘目录已同步");
      }
    } catch (value) { setError(value instanceof Error ? value.message : "同步失败。"); }
    finally { setBusy(undefined); }
  };

  return <div className="fixed inset-0 z-[80] grid place-items-center bg-[#171713]/20 px-5" role="dialog" aria-modal="true" aria-label="飞书连接设置">
    <div className="w-full max-w-[620px] rounded-[12px] border border-[#dddcd6] bg-white shadow-[0_24px_80px_rgba(20,20,16,0.18)]">
      <header className="flex items-start border-b border-[#ebeae5] px-5 py-4"><div><h2 className="text-panel-title font-semibold text-[#2f302c]">连接设置</h2><p className="mt-1 text-caption text-[#999890]">连接后，项目材料目录会按照飞书中的结构自动更新。</p></div><button type="button" onClick={onClose} disabled={Boolean(busy)} className="ml-auto text-[18px] text-[#999890]">×</button></header>
      <div className="max-h-[72vh] space-y-5 overflow-y-auto p-5">
        <section><h3 className="text-body font-semibold text-[#464741]">飞书知识库</h3><p className="mt-1 text-caption text-[#999890]">用于 DOCX、PDF、XLSX 等文档。</p>{data.knowledgeScopes.map((scope) => <div key={scope.id} className="mt-2 flex items-center gap-2 rounded-md border border-[#e5e4df] px-3 py-2"><div className="min-w-0 flex-1"><p className="truncate text-control font-medium text-[#55564f]">{scope.display_name}</p><p className="mt-0.5 text-micro text-[#aaa9a1]">{scope.last_sync_status === "ready" ? "已连接" : scope.last_sync_status === "failed" ? "同步失败" : "同步中"} · 每周同步</p></div><a href={scope.source_url} target="_blank" rel="noreferrer" className="text-caption text-[#65766e]">打开飞书 ↗</a><button type="button" onClick={() => void sync("knowledge", scope.id)} disabled={Boolean(busy)} className="h-7 rounded border border-[#deddd7] px-2 text-caption disabled:opacity-40">{busy === `sync:${scope.id}` ? "同步中…" : "立即同步"}</button></div>)}<div className="mt-2 flex gap-2"><input value={knowledgeUrl} onChange={(event) => setKnowledgeUrl(event.target.value)} disabled={Boolean(busy)} placeholder="粘贴飞书知识库地址" className="h-9 min-w-0 flex-1 rounded-md border border-[#deddd7] px-3 text-control outline-none" /><button type="button" onClick={() => void connect("knowledge")} disabled={!knowledgeUrl.trim() || Boolean(busy)} className="h-9 rounded-md bg-[#30342f] px-3 text-control text-white disabled:opacity-40">{busy === "connect:knowledge" || busy === "sync:knowledge" ? "连接中…" : "连接"}</button></div></section>
        <section><h3 className="text-body font-semibold text-[#464741]">飞书云盘</h3><p className="mt-1 text-caption text-[#999890]">用于图片、视频和音频。</p>{data.driveScopes.map((scope) => <div key={scope.id} className="mt-2 flex items-center gap-2 rounded-md border border-[#e5e4df] px-3 py-2"><div className="min-w-0 flex-1"><p className="truncate text-control font-medium text-[#55564f]">{scope.display_name}</p><p className="mt-0.5 text-micro text-[#aaa9a1]">{scope.last_sync_status === "ready" ? "已连接" : scope.last_sync_status === "failed" ? "同步失败" : "同步中"} · 每周同步</p></div><a href={scope.source_url} target="_blank" rel="noreferrer" className="text-caption text-[#65766e]">打开飞书 ↗</a><button type="button" onClick={() => void sync("drive", scope.id)} disabled={Boolean(busy)} className="h-7 rounded border border-[#deddd7] px-2 text-caption disabled:opacity-40">{busy === `sync:${scope.id}` ? "同步中…" : "立即同步"}</button></div>)}<div className="mt-2 flex gap-2"><input value={driveUrl} onChange={(event) => setDriveUrl(event.target.value)} disabled={Boolean(busy)} placeholder="粘贴具体 /drive/folder/… 地址" className="h-9 min-w-0 flex-1 rounded-md border border-[#deddd7] px-3 text-control outline-none" /><button type="button" onClick={() => void connect("drive")} disabled={!driveUrl.trim() || Boolean(busy)} className="h-9 rounded-md bg-[#30342f] px-3 text-control text-white disabled:opacity-40">{busy === "connect:drive" || busy === "sync:drive" ? "连接中…" : "连接"}</button></div></section>
        {error && <p role="alert" className="rounded-md bg-[#fbf3ef] px-3 py-2 text-caption text-[#955c4c]">{error}</p>}
      </div>
      <footer className="flex justify-end border-t border-[#ebeae5] px-5 py-3"><button type="button" onClick={onClose} disabled={Boolean(busy)} className="h-8 rounded-md border border-[#deddd7] px-3 text-control">完成</button></footer>
    </div>
  </div>;
}

export function ProjectMaterialsPanel({ projectId, onNotice }: { projectId: string | null; onNotice: (message: string) => void }) {
  const [data, setData] = useState<ProjectMaterialsPayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    const response = await fetch(`/api/projects/materials?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as ProjectMaterialsPayload & { error?: string } | null;
    if (!response.ok || !payload?.knowledgeScopes || !payload?.driveScopes) throw new Error(payload?.error || "暂时无法读取项目材料。");
    setData(payload);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    const loadInitial = async () => {
      try { await load(); }
      catch (value) { if (!cancelled) setError(value instanceof Error ? value.message : "加载失败。"); }
      finally { if (!cancelled) setLoading(false); }
    };
    void loadInitial();
    const refresh = () => void load();
    window.addEventListener("sugar:materials-changed", refresh);
    return () => { cancelled = true; window.removeEventListener("sugar:materials-changed", refresh); };
  }, [load]);

  const directories = useMemo(() => {
    if (!data) return { knowledge: [] as Array<{ scope: KnowledgeScope; nodes: TreeNode[] }>, drive: [] as Array<{ scope: DriveScope; nodes: TreeNode[] }> };
    return {
      knowledge: data.knowledgeScopes.map((scope) => ({ scope, nodes: filterTree(buildKnowledgeTree(scope, data.knowledgeItems.filter((item) => item.sync_scope_id === scope.id)), query) })),
      drive: data.driveScopes.map((scope) => ({ scope, nodes: filterTree(buildDriveTree(scope, data.driveItems.filter((item) => item.scope_id === scope.id)), query) })),
    };
  }, [data, query]);

  if (!projectId) return <p className="text-body text-[#999890]">请选择项目后查看项目材料。</p>;
  if (loading) return <div role="status" className="flex items-center gap-2 py-10 text-control text-[#999890]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#71877c]" />正在读取项目材料目录…</div>;
  if (!data) return <p role="alert" className="text-control text-[#955c4c]">{error || "暂时无法读取项目材料。"}</p>;
  const connected = data.knowledgeScopes.length > 0 || data.driveScopes.length > 0;

  return <div className="mx-auto w-full max-w-[1120px]">
    <div className="flex items-start gap-4"><div className="min-w-0 flex-1"><h2 className="text-section-title font-semibold text-[#2e2f2b]">项目材料</h2><p className="mt-2 max-w-[900px] text-control leading-[1.75] text-[#7d7e77]">当前项目的工作空间中，Agent可使用的资料如下，已与飞书连接，请勿轻易修改连接设置，谢谢！<br />飞书知识库中是文档（DOCX、PDF、XLSX等），飞书云盘中是媒体文件（图片、视频、音频）。您与Agent对话中上传的资料，或新产生的成果，也会同步上传至飞书（上传前会获取您的确认）。</p></div><button type="button" onClick={() => setSettingsOpen(true)} className="h-8 shrink-0 rounded-md border border-[#deddd7] px-3 text-control text-[#62635d] hover:bg-[#f5f5f2]">连接设置</button></div>
    <div className="mt-5 flex items-center gap-3 border-b border-[#e8e7e2] pb-3"><div className="relative min-w-0 flex-1"><span className="pointer-events-none absolute left-3 top-2 text-control text-[#aaa9a1]">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索材料名称或内容" className="h-8 w-full rounded-md border border-[#e0dfda] bg-white pl-8 pr-3 text-control outline-none focus:border-[#aab2ac]" /></div><span className="shrink-0 text-micro text-[#aaa9a1]">{connected ? `已与飞书同步 · ${relativeSync(data.lastSyncedAt)}` : "尚未连接飞书"}</span></div>
    <section className="mt-4 overflow-hidden rounded-[9px] border border-[#e3e2dc] bg-white">
      <header className="border-b border-[#ebeae5] bg-[#fafaf8] px-4 py-3 text-control font-semibold text-[#5a5b55]">项目材料目录</header>
      {!connected ? <div className="px-5 py-12 text-center"><p className="text-body font-medium text-[#55564f]">尚未连接飞书项目材料</p><button type="button" onClick={() => setSettingsOpen(true)} className="mt-3 h-8 rounded-md bg-[#30342f] px-3 text-control text-white">连接飞书</button></div> : <div className="divide-y divide-[#ebeae5]">
        <details open><summary className="flex cursor-pointer list-none items-center gap-2 bg-[#fbfbf9] px-4 py-3 text-body font-semibold text-[#44453f] [&::-webkit-details-marker]:hidden"><span className="text-[#3370ff]">飞</span>飞书知识库<span className="ml-auto text-micro font-normal text-[#aaa9a1]">{data.knowledgeItems.length} 项</span></summary><div className="px-4">{directories.knowledge.flatMap(({ scope, nodes }) => nodes.length ? nodes.map((node) => <MaterialNode key={`${scope.id}:${node.key}`} node={node} forceOpen={Boolean(query)} />) : []).length ? directories.knowledge.flatMap(({ scope, nodes }) => nodes.map((node) => <MaterialNode key={`${scope.id}:${node.key}`} node={node} forceOpen={Boolean(query)} />)) : <p className="py-6 text-center text-caption text-[#aaa9a1]">{query ? "没有匹配的知识库材料" : "知识库中暂时没有可见材料"}</p>}</div></details>
        <details open><summary className="flex cursor-pointer list-none items-center gap-2 bg-[#fbfbf9] px-4 py-3 text-body font-semibold text-[#44453f] [&::-webkit-details-marker]:hidden"><span className="text-[#63758f]">盘</span>飞书云盘<span className="ml-auto text-micro font-normal text-[#aaa9a1]">{data.driveItems.length} 项</span></summary><div className="px-4">{directories.drive.flatMap(({ scope, nodes }) => nodes.length ? nodes.map((node) => <MaterialNode key={`${scope.id}:${node.key}`} node={node} forceOpen={Boolean(query)} />) : []).length ? directories.drive.flatMap(({ scope, nodes }) => nodes.map((node) => <MaterialNode key={`${scope.id}:${node.key}`} node={node} forceOpen={Boolean(query)} />)) : <p className="py-6 text-center text-caption text-[#aaa9a1]">{query ? "没有匹配的云盘材料" : "云盘中暂时没有可见材料"}</p>}</div></details>
      </div>}
    </section>
    {error && <p role="alert" className="mt-3 text-caption text-[#955c4c]">{error}</p>}
    {settingsOpen && <ConnectionSettings projectId={projectId} data={data} onClose={() => setSettingsOpen(false)} onChanged={load} onNotice={onNotice} />}
  </div>;
}
