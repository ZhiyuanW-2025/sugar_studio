"use client";

import { useEffect, useState } from "react";
import { agentMeta } from "./mockData";
import type { AgentId } from "./types";

export function QuickHandoffModal({ projectId, source, target, initialTitle, initialContent, sending, error, onCancel, onConfirm }: {
  projectId: string;
  source: AgentId;
  target: AgentId;
  initialTitle: string;
  initialContent: string;
  sending: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (title: string, content: string, priority: "low" | "normal" | "high", projectFileIds: string[]) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [files, setFiles] = useState<Array<{ id: string; fileName: string; supersededAt: string | null }>>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetch(`/api/projects/files?projectId=${encodeURIComponent(projectId)}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((body) => { if (active) setFiles((body.files ?? []).filter((file: { supersededAt: string | null }) => !file.supersededAt)); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoadingFiles(false); });
    return () => { active = false; controller.abort(); };
  }, [projectId]);

  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#161613]/25 px-6 backdrop-blur-[1px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) onCancel(); }}>
    <div role="dialog" aria-modal="true" className="panel-in w-full max-w-[620px] rounded-[12px] border border-[#d9d8d2] bg-white shadow-[0_30px_90px_rgba(20,20,16,.22)]">
      <header className="border-b border-[#e8e7e2] px-5 py-4"><h2 className="text-panel-title font-semibold text-[#292925]">{agentMeta[source].name} → {agentMeta[target].name}</h2><p className="mt-1 text-control text-[#8e8d85]">这是可追踪的协作任务；只有你确认后才会送达。</p></header>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
        <label className="block"><span className="mb-1 block text-control text-[#77766f]">任务标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} className="h-9 w-full rounded border border-[#deded8] px-3 text-body outline-none" /></label>
        <label className="block"><span className="mb-1 block text-control text-[#77766f]">已确认内容</span><textarea value={content} onChange={(event) => setContent(event.target.value)} rows={12} className="w-full resize-y rounded border border-[#deded8] p-3 text-body leading-5 outline-none" /></label>
        <label className="block"><span className="mb-1 block text-control text-[#77766f]">优先级</span><select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)} className="h-8 rounded border border-[#deded8] px-2 text-control"><option value="low">低</option><option value="normal">普通</option><option value="high">高</option></select></label>
        {loadingFiles && <p role="status" className="text-caption text-[#999890]"><span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#557267]" />正在读取可附带的项目材料…</p>}
        {files.length > 0 && <fieldset><legend className="mb-1 text-control text-[#77766f]">随任务附带项目材料（可选）</legend><div className="max-h-24 overflow-y-auto rounded border border-[#e6e6e1] p-1.5">{files.map((file) => <label key={file.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-caption hover:bg-[#f5f5f2]"><input type="checkbox" checked={selectedFiles.includes(file.id)} onChange={(event) => setSelectedFiles((current) => event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id))} />{file.fileName}</label>)}</div></fieldset>}
        {error && <p className="text-control text-[#98584b]">{error}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-[#e8e7e2] bg-[#fbfbf9] px-5 py-3"><button onClick={onCancel} disabled={sending} className="h-8 px-3 text-body">取消</button><button aria-busy={sending} onClick={() => onConfirm(title.trim(), content.trim(), priority, selectedFiles)} disabled={sending || !title.trim() || !content.trim()} className="h-8 rounded bg-[#252522] px-3 text-body text-white disabled:opacity-35">{sending ? "发送中…" : "确认交接"}</button></footer>
    </div>
  </div>;
}
