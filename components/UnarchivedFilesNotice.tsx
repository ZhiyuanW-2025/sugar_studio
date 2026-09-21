"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project } from "./types";

type InboxFile = { id: string; fileName: string; createdAt: string; sourceProjectName: string; knowledge: { id: string; status: string; user_description: string; agent_summary: string } | null };

export function UnarchivedFilesNotice({ projects, onNotice }: { projects: Pick<Project, "id" | "name">[]; onNotice: (message: string) => void }) {
  const [files, setFiles] = useState<InboxFile[]>([]);
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    const response = await fetch("/api/knowledge/unarchived-files", { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { files?: InboxFile[] } | null;
    if (response.ok && Array.isArray(payload?.files)) setFiles(payload.files);
  }, []);
  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const refresh = () => void load();
    window.addEventListener("sugar:unarchived-changed", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => { window.clearTimeout(initialLoad); window.removeEventListener("sugar:unarchived-changed", refresh); window.clearInterval(timer); };
  }, [load]);
  const archive = async (file: InboxFile) => {
    const targetProjectId = targets[file.id];
    if (!targetProjectId || busyId) return;
    setBusyId(file.id); setError(undefined);
    try {
      const response = await fetch(`/api/knowledge/unarchived-files/${file.id}/archive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetProjectId }) });
      const payload = await response.json().catch(() => null) as { archived?: boolean; indexing?: { status?: string; error?: string }; error?: string } | null;
      if (!response.ok || !payload?.archived) throw new Error(payload?.error || "归档失败。");
      setFiles((current) => current.filter((item) => item.id !== file.id));
      const targetName = projects.find((item) => item.id === targetProjectId)?.name || "目标项目";
      onNotice(payload.indexing?.status === "ready" ? `「${file.fileName}」已归档到「${targetName}」并完成解析` : `「${file.fileName}」已归档，解析任务将自动重试`);
      if (payload.indexing?.error) setError(payload.indexing.error);
    } catch (archiveError) { setError(archiveError instanceof Error ? archiveError.message : "归档失败。"); }
    finally { setBusyId(undefined); }
  };
  if (files.length === 0) return null;
  return <div className="fixed bottom-5 right-5 z-[65]">
    {open && <div className="mb-2 w-[380px] overflow-hidden rounded-[10px] border border-[#dcdcd6] bg-white shadow-[0_18px_55px_rgba(25,25,20,0.16)]">
      <div className="flex items-center justify-between border-b border-[#e8e7e2] px-4 py-3"><div><p className="text-body font-semibold text-[#393934]">未归档文件</p><p className="mt-0.5 text-caption text-[#999890]">为每份文件选择它真正所属的项目</p></div><button type="button" onClick={() => setOpen(false)} className="text-[16px] text-[#999890]">×</button></div>
      <div className="max-h-[360px] space-y-2 overflow-y-auto p-3">
        {files.map((file) => <div key={file.id} className="rounded-[8px] border border-[#e5e4df] p-3">
          <p className="truncate text-body font-medium text-[#454540]">{file.fileName}</p><p className="mt-1 text-caption text-[#999890]">上传对话：{file.sourceProjectName}</p>
          {file.knowledge?.user_description && <p className="mt-1 line-clamp-2 text-caption leading-4 text-[#77766f]">{file.knowledge.user_description}</p>}
          <div className="mt-2 flex gap-2"><select value={targets[file.id] || ""} disabled={busyId === file.id} onChange={(event) => setTargets((current) => ({ ...current, [file.id]: event.target.value }))} className="h-7 min-w-0 flex-1 rounded-md border border-[#dcdcd6] bg-white px-2 text-caption text-[#55554f]"><option value="">选择归档项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button type="button" disabled={!targets[file.id] || Boolean(busyId)} onClick={() => void archive(file)} className="h-7 rounded-md bg-[#243f34] px-3 text-caption font-medium text-white disabled:opacity-35">{busyId === file.id ? "归档中…" : "归档"}</button></div>
        </div>)}
        {error && <p className="text-caption text-[#98584b]">{error}</p>}
      </div>
    </div>}
    <button type="button" onClick={() => setOpen((value) => !value)} className="flex h-9 items-center gap-2 rounded-full border border-[#d9d7cb] bg-[#fffdf4] px-3 text-control font-medium text-[#6f6341] shadow-[0_6px_22px_rgba(40,36,20,0.12)]"><span className="h-2 w-2 rounded-full bg-[#d5a33c]" /> 未归档文件 {files.length}</button>
  </div>;
}
