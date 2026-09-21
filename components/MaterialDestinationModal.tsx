"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectMaterialsPayload } from "./ProjectMaterialsPanel";

export type MaterialDestination = {
  target: "knowledge" | "drive";
  scopeId: string;
  parentToken: string | null;
  label: string;
};

const mediaExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif", "mp4", "mov", "m4v", "webm", "mp3", "wav", "m4a", "aac", "flac", "ogg"]);

export function materialTargetForFile(fileName: string): "knowledge" | "drive" {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return mediaExtensions.has(extension) ? "drive" : "knowledge";
}

type Option = { scopeId: string; token: string | null; label: string; depth: number };

function knowledgeOptions(data: ProjectMaterialsPayload): Option[] {
  const output: Option[] = [];
  for (const scope of data.knowledgeScopes) {
    output.push({ scopeId: scope.id, token: scope.root_node_token, label: scope.display_name, depth: 0 });
    const items = data.knowledgeItems.filter((item) => item.sync_scope_id === scope.id);
    const tokens = new Set(items.map((item) => item.node_token));
    const append = (item: (typeof items)[number], depth: number) => {
      if (output.some((candidate) => candidate.scopeId === scope.id && candidate.token === item.node_token)) return;
      output.push({ scopeId: scope.id, token: item.node_token, label: item.title, depth });
      for (const child of items.filter((candidate) => candidate.parent_node_token === item.node_token)) append(child, depth + 1);
    };
    for (const item of items.filter((candidate) => candidate.parent_node_token === scope.root_node_token || !candidate.parent_node_token || !tokens.has(candidate.parent_node_token))) {
      append(item, 1);
    }
    for (const item of items) if (!output.some((candidate) => candidate.scopeId === scope.id && candidate.token === item.node_token)) output.push({ scopeId: scope.id, token: item.node_token, label: item.title, depth: 1 });
  }
  return output;
}

function driveOptions(data: ProjectMaterialsPayload): Option[] {
  const output: Option[] = [];
  for (const scope of data.driveScopes) {
    output.push({ scopeId: scope.id, token: scope.folder_token, label: scope.display_name, depth: 0 });
    const folders = data.driveItems.filter((item) => item.scope_id === scope.id && item.item_type === "folder");
    const visit = (parent: string, depth: number) => {
      for (const item of folders.filter((candidate) => candidate.parent_file_token === parent)) {
        output.push({ scopeId: scope.id, token: item.file_token, label: item.file_name, depth });
        visit(item.file_token, depth + 1);
      }
    };
    visit(scope.folder_token, 1);
    for (const item of folders) if (!output.some((candidate) => candidate.scopeId === scope.id && candidate.token === item.file_token)) output.push({ scopeId: scope.id, token: item.file_token, label: item.file_name, depth: 1 });
  }
  return output;
}

export function MaterialDestinationModal({ projectId, fileName, fixedTarget, onCancel, onConfirm, onUseConversationOnly }: {
  projectId: string;
  fileName?: string;
  fixedTarget?: "knowledge" | "drive";
  onCancel: () => void;
  onConfirm: (destination: MaterialDestination) => void;
  onUseConversationOnly?: () => void;
}) {
  const target = fixedTarget ?? materialTargetForFile(fileName ?? "result.docx");
  const [data, setData] = useState<ProjectMaterialsPayload>();
  const [selected, setSelected] = useState("");
  const [folderName, setFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/materials?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as ProjectMaterialsPayload & { error?: string } | null;
    if (!response.ok || !payload?.knowledgeScopes) throw new Error(payload?.error || "暂时无法读取飞书目录。");
    setData(payload);
  }, [projectId]);
  useEffect(() => {
    let cancelled = false;
    const loadInitial = async () => {
      try { await load(); }
      catch (value) { if (!cancelled) setError(value instanceof Error ? value.message : "加载失败。"); }
    };
    void loadInitial();
    return () => { cancelled = true; };
  }, [load]);

  const options = useMemo(() => data ? target === "knowledge" ? knowledgeOptions(data) : driveOptions(data) : [], [data, target]);
  const effectiveSelected = selected || (options[0] ? `${options[0].scopeId}|${options[0].token ?? ""}` : "");
  const current = options.find((item) => `${item.scopeId}|${item.token ?? ""}` === effectiveSelected);

  const createFolder = async () => {
    if (!current || !folderName.trim() || creating) return;
    setCreating(true); setError(undefined);
    try {
      const response = await fetch("/api/projects/materials/folders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, target, scopeId: current.scopeId, parentToken: current.token, name: folderName.trim() }),
      });
      const payload = await response.json().catch(() => null) as { token?: string; name?: string; error?: string } | null;
      if (!response.ok || !payload?.token) throw new Error(payload?.error || "新建目录失败。");
      await load();
      setSelected(`${current.scopeId}|${payload.token}`); setFolderName("");
    } catch (value) { setError(value instanceof Error ? value.message : "新建目录失败。"); }
    finally { setCreating(false); }
  };

  return <div className="fixed inset-0 z-[100] grid place-items-center bg-[#171713]/20 px-5" role="dialog" aria-modal="true" aria-label="选择飞书保存位置">
    <div className="w-full max-w-[500px] rounded-[12px] border border-[#dddcd6] bg-white shadow-[0_24px_80px_rgba(20,20,16,0.18)]">
      <header className="flex items-start border-b border-[#ebeae5] px-5 py-4"><div><h3 className="text-panel-title font-semibold text-[#2f302c]">保存到项目材料</h3><p className="mt-1 text-caption text-[#999890]">{target === "knowledge" ? "文档将上传到飞书知识库" : "图片、视频或音频将上传到飞书云盘"}</p></div><button type="button" onClick={onCancel} disabled={creating} className="ml-auto text-[18px] text-[#999890]">×</button></header>
      <div className="p-5">
        {fileName && <div className="mb-3 rounded-md bg-[#f7f7f4] px-3 py-2 text-control text-[#60615b]">{fileName}</div>}
        {options.length > 0 ? <label className="block text-control text-[#666760]">保存位置<select value={effectiveSelected} onChange={(event) => setSelected(event.target.value)} disabled={creating} className="mt-1.5 h-10 w-full rounded-md border border-[#deddd7] bg-white px-2.5 text-control outline-none">{options.map((item) => <option key={`${item.scopeId}:${item.token ?? "root"}`} value={`${item.scopeId}|${item.token ?? ""}`}>{`${"　".repeat(item.depth)}${item.depth ? "└ " : ""}${item.label}`}</option>)}</select></label> : <div className="rounded-md bg-[#fbf3ef] px-3 py-2 text-control text-[#8e5f4f]">当前项目尚未连接{target === "knowledge" ? "飞书知识库" : "飞书云盘"}，请先到“项目材料 → 连接设置”完成连接。</div>}
        {current && <div className="mt-3 flex gap-2"><input value={folderName} onChange={(event) => setFolderName(event.target.value)} disabled={creating} placeholder="在所选位置新建目录" className="h-8 min-w-0 flex-1 rounded-md border border-[#deddd7] px-2.5 text-caption outline-none" /><button type="button" onClick={() => void createFolder()} disabled={!folderName.trim() || creating} className="h-8 rounded-md border border-[#deddd7] px-2.5 text-caption disabled:opacity-40">{creating ? "创建中…" : "＋ 新建目录"}</button></div>}
        {error && <p role="alert" className="mt-3 text-caption text-[#955c4c]">{error}</p>}
      </div>
      <footer className="flex items-center gap-2 border-t border-[#ebeae5] px-5 py-3">{onUseConversationOnly && <button type="button" onClick={onUseConversationOnly} disabled={creating} className="mr-auto h-8 px-1 text-control text-[#777870]">仅用于本次对话</button>}<button type="button" onClick={onCancel} disabled={creating} className="h-8 rounded-md border border-[#deddd7] px-3 text-control">取消</button><button type="button" disabled={!current || creating} onClick={() => current && onConfirm({ target, scopeId: current.scopeId, parentToken: current.token, label: current.label })} className="h-8 rounded-md bg-[#30342f] px-3 text-control text-white disabled:opacity-40">确认保存位置</button></footer>
    </div>
  </div>;
}
