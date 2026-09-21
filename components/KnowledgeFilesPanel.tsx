"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";

type KnowledgeState = {
  documentId: string;
  status: "pending" | "processing" | "ready" | "failed" | "unsupported";
  pageCount: number | null;
  chunkCount: number;
  error: string | null;
  indexedAt: string | null;
  userDescription: string;
  agentSummary: string;
  job: {
    status: string;
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt: string;
    progress: number;
    progressMessage: string | null;
  } | null;
};

type KnowledgeFile = {
  id: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  size: number;
  uploaderName: string;
  createdAt: string;
  version: number;
  replacesFileId: string | null;
  supersededAt: string | null;
  sourceProvider: "upload" | "feishu";
  sourceUrl: string | null;
  knowledge: KnowledgeState | null;
};

type Props = {
  listEndpoint: string;
  uploadEndpoint: string;
  uploadFields?: Record<string, string>;
  fileUrl: (id: string) => string;
  emptyTitle: string;
  emptyDescription: string;
  uploadNotice: string;
  onNotice: (message: string) => void;
  sourceProjectId?: string;
  archiveProjects?: Array<{ id: string; name: string }>;
};

const acceptedExtensions = ".pdf,.docx,.pptx,.xlsx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.gif";

type PendingUpload = {
  id: string;
  file: File;
  displayName: string;
  userDescription: string;
};

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function knowledgeLabel(knowledge: KnowledgeState | null) {
  if (!knowledge) return { label: "等待知识记录", tone: "text-[#9b7d51]" };
  if (knowledge.status === "ready") {
    const details = [knowledge.pageCount ? `${knowledge.pageCount} 页` : null, `${knowledge.chunkCount} 个知识片段`]
      .filter(Boolean)
      .join(" · ");
    return { label: `已进入知识库 · ${details}`, tone: "text-[#527564]" };
  }
  if (knowledge.status === "processing") return { label: `${knowledge.job?.progressMessage || "正在解析并建立索引"} · ${knowledge.job?.progress ?? 0}%`, tone: "text-[#6c7392]" };
  if (knowledge.status === "pending") return { label: knowledge.job?.attemptCount ? `${knowledge.job.progressMessage || "等待自动重试"} · 已尝试 ${knowledge.job.attemptCount}/${knowledge.job.maxAttempts}` : "等待建立知识索引", tone: "text-[#9b7d51]" };
  if (knowledge.status === "unsupported") return { label: "已保存 · 当前格式暂不支持文字解析", tone: "text-[#999890]" };
  return { label: knowledge.error || "解析失败，可重新尝试", tone: "text-[#9a5f50]" };
}

const FileMark = ({ extension }: { extension: string }) => (
  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[7px] border border-[#e2e1dc] bg-[#f8f8f5] text-micro font-semibold uppercase tracking-[0.06em] text-[#78776f]">
    {extension.slice(0, 5)}
  </div>
);

export function KnowledgeFilesPanel(props: Props) {
  const { onNotice } = props;
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [indexingId, setIndexingId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const [replaceTargetId, setReplaceTargetId] = useState<string>();
  const [movingId, setMovingId] = useState<string>();
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [preview, setPreview] = useState<{
    document: { fileName: string; fileUrl: string; pageCount: number | null; chunkCount: number };
    chunks: Array<{ id: string; content: string; page_number: number | null; section_title: string | null }>;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string>();
  const [error, setError] = useState<string>();
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const autoIndexAttemptedRef = useRef(new Set<string>());

  const loadFiles = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const response = await fetch(props.listEndpoint, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as { files?: KnowledgeFile[]; error?: string } | null;
      if (!response.ok || !Array.isArray(payload?.files)) throw new Error(payload?.error || "暂时无法加载文件。");
      setFiles(payload.files);
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "暂时无法加载文件。");
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [props.listEndpoint]);

  useEffect(() => {
    let cancelled = false;
    const loadInitialFiles = async () => {
      await loadFiles();
      if (cancelled) return;
    };
    void loadInitialFiles();
    return () => {
      cancelled = true;
    };
  }, [loadFiles]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`knowledge-files-${props.listEndpoint}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_files" }, () => void loadFiles(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "knowledge_documents" }, () => void loadFiles(true))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadFiles, props.listEndpoint]);

  useEffect(() => {
    if (!files.some((file) => file.knowledge?.status === "processing")) return;
    const timer = window.setInterval(() => void loadFiles(true), 2_000);
    return () => window.clearInterval(timer);
  }, [files, loadFiles]);

  const indexDocument = useCallback(async (documentId: string) => {
    if (indexingId) return false;
    setIndexingId(documentId);
    setError(undefined);
    try {
      const response = await fetch(`/api/knowledge/documents/${documentId}/index`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { status?: string; error?: string } | null;
      if (!response.ok || payload?.status !== "ready") throw new Error(payload?.error || "知识索引建立失败。");
      onNotice("文件已进入知识库，Agent 现在可以检索");
      return true;
    } catch (indexError) {
      setError(indexError instanceof Error ? indexError.message : "知识索引建立失败。");
      return false;
    } finally {
      setIndexingId(undefined);
      await loadFiles(true);
    }
  }, [indexingId, loadFiles, onNotice]);

  useEffect(() => {
    if (isLoading || indexingId) return;
    const next = files.find((file) => file.knowledge?.status === "pending" && !autoIndexAttemptedRef.current.has(file.knowledge.documentId));
    if (!next?.knowledge) return;
    autoIndexAttemptedRef.current.add(next.knowledge.documentId);
    const timer = window.setTimeout(() => void indexDocument(next.knowledge!.documentId), 0);
    return () => window.clearTimeout(timer);
  }, [files, indexDocument, indexingId, isLoading]);

  const uploadFiles = async (selectedFiles: Array<{ file: File; displayName?: string; userDescription?: string }>, replacesFileId?: string) => {
    if (isUploading) return;
    setIsUploading(true);
    setError(undefined);
    const documentsToIndex: string[] = [];

    try {
      for (const item of selectedFiles) {
        const file = item.file;
        const form = new FormData();
        form.set("file", file);
        if (item.displayName?.trim()) form.set("displayName", item.displayName.trim());
        if (item.userDescription?.trim()) form.set("userDescription", item.userDescription.trim());
        if (replacesFileId) form.set("replacesFileId", replacesFileId);
        for (const [key, value] of Object.entries(props.uploadFields ?? {})) form.set(key, value);
        const response = await fetch(props.uploadEndpoint, { method: "POST", body: form });
        const payload = (await response.json().catch(() => null)) as {
          uploaded?: boolean;
          knowledge?: { documentId: string; status: KnowledgeState["status"] } | null;
          error?: string;
        } | null;
        if (!response.ok || !payload?.uploaded) throw new Error(payload?.error || `「${file.name}」上传失败。`);
        if (payload.knowledge?.status === "pending") documentsToIndex.push(payload.knowledge.documentId);
      }
      props.onNotice(selectedFiles.length > 1 ? `${selectedFiles.length} 个文件已上传，正在后台建立索引` : props.uploadNotice);
      setPendingUploads([]);
      await loadFiles(true);
      void (async () => {
        for (const documentId of documentsToIndex) await indexDocument(documentId);
      })();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "文件上传失败。");
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      if (replaceInputRef.current) replaceInputRef.current.value = "";
      setReplaceTargetId(undefined);
    }
  };

  const previewDocument = async (documentId: string) => {
    if (previewLoading) return;
    setPreviewLoading(documentId); setError(undefined);
    try {
      const response = await fetch(`/api/knowledge/documents/${documentId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as typeof preview & { error?: string } | null;
      if (!response.ok || !payload?.document || !payload.chunks) throw new Error(payload?.error || "内容预览加载失败。");
      setPreview(payload);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "内容预览加载失败。");
    } finally { setPreviewLoading(undefined); }
  };

  const deleteFile = async (file: KnowledgeFile) => {
    if (deletingId || !window.confirm(`确认删除「${file.fileName}」？对应知识索引也会一并删除。`)) return;
    setDeletingId(file.id);
    setError(undefined);
    try {
      const response = await fetch(props.fileUrl(file.id), { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { deleted?: boolean; error?: string } | null;
      if (!response.ok || !payload?.deleted) throw new Error(payload?.error || "文件删除失败。");
      setFiles((current) => current.filter((item) => item.id !== file.id));
      props.onNotice("文件及对应知识索引已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "文件删除失败。");
    } finally {
      setDeletingId(undefined);
    }
  };

  const moveFile = async (file: KnowledgeFile) => {
    const targetProjectId = moveTargets[file.id];
    if (!props.sourceProjectId || !targetProjectId || movingId) return;
    setMovingId(file.id); setError(undefined);
    try {
      const response = await fetch(`/api/projects/files/${file.id}/move`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceProjectId: props.sourceProjectId, targetProjectId }) });
      const payload = await response.json().catch(() => null) as { moved?: boolean; indexing?: { status?: string; error?: string }; error?: string } | null;
      if (!response.ok || !payload?.moved) throw new Error(payload?.error || "文件移动失败。");
      setFiles((current) => current.filter((item) => item.id !== file.id));
      const targetName = props.archiveProjects?.find((item) => item.id === targetProjectId)?.name || "目标项目";
      props.onNotice(payload.indexing?.status === "ready" ? `文件已移动到「${targetName}」并完成解析` : `文件已移动到「${targetName}」，解析任务将自动重试`);
      if (payload.indexing?.error) setError(payload.indexing.error);
    } catch (moveError) { setError(moveError instanceof Error ? moveError.message : "文件移动失败。"); }
    finally { setMovingId(undefined); }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-control text-[#999890]">PDF、Office、文本与图片 OCR 自动进入知识库。支持多选，单文件不超过 25 MB</p>
        <label aria-busy={isUploading} className={`ml-3 shrink-0 rounded-md bg-[#292925] px-3 py-2 text-control font-medium text-white hover:bg-[#11110f] ${isUploading ? "pointer-events-none opacity-55" : "cursor-pointer"}`}>
          {isUploading ? "上传中…" : "上传文件"}
          <input
            ref={inputRef}
            type="file"
            accept={acceptedExtensions}
            multiple
            disabled={isUploading}
            className="sr-only"
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              if (selected.length) setPendingUploads(selected.map((file) => ({ id: crypto.randomUUID(), file, displayName: file.name, userDescription: "" })));
            }}
          />
        </label>
      </div>

      {error && <div role="alert" className="mb-4 rounded-md border border-[#eadfd8] bg-[#fbf5f1] px-3 py-2 text-body leading-5 text-[#895c49]">{error}</div>}

      {isLoading ? (
        <p role="status" className="py-5 text-center text-body text-[#999890]"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#557267]" />正在加载文件…</p>
      ) : files.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-[#deddd7] px-4 py-8 text-center">
          <p className="text-body font-medium text-[#62615b]">{props.emptyTitle}</p>
          <p className="mt-1 text-control text-[#aaa9a1]">{props.emptyDescription}</p>
        </div>
      ) : (
        <div>
          {files.some((file) => file.supersededAt) && <button type="button" onClick={() => setShowHistory((value) => !value)} className="mb-2 text-caption text-[#77766f] underline underline-offset-2">{showHistory ? "隐藏旧文件版本" : "显示旧文件版本"}</button>}
          <div className="divide-y divide-[#ecebe7] border-y border-[#ecebe7]">
          {files.filter((file) => showHistory || !file.supersededAt).map((file) => {
            const knowledge = knowledgeLabel(file.knowledge);
            const canIndex = file.knowledge && ["pending", "failed"].includes(file.knowledge.status);
            return (
              <div key={file.id} className="flex items-start gap-3 py-3">
                <FileMark extension={file.fileType} />
                <div className="min-w-0 flex-1">
                  <a href={file.sourceProvider === "feishu" && file.sourceUrl ? file.sourceUrl : props.fileUrl(file.id)} target="_blank" rel="noreferrer" className="block truncate text-body font-medium text-[#44443f] hover:underline">
                    {file.fileName}
                  </a>
                  <span className="mt-1 block text-caption text-[#aaa9a1]">
                    {file.sourceProvider === "feishu" ? "飞书权威版本" : `v${file.version || 1}`}{file.supersededAt ? " · 旧版本" : ""} · {formatSize(file.size)} · {file.uploaderName} · {formatDate(file.createdAt)}
                  </span>
                  <div className={`mt-1.5 flex items-center gap-2 text-caption ${knowledge.tone}`}>
                    <span>{knowledge.label}</span>
                    {canIndex && (
                      <button
                        type="button"
                        aria-busy={indexingId === file.knowledge!.documentId}
                        disabled={Boolean(indexingId)}
                        onClick={() => void indexDocument(file.knowledge!.documentId)}
                        className="font-medium underline underline-offset-2 disabled:opacity-40"
                      >
                        {indexingId === file.knowledge!.documentId ? "处理中…" : file.knowledge!.status === "failed" ? "重新解析" : "开始解析"}
                      </button>
                    )}
                  </div>
                  {file.knowledge?.job?.status === "processing" && <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#ecebe7]"><div className="h-full bg-[#71877c] transition-all" style={{ width: `${file.knowledge.job.progress}%` }} /></div>}
                  {file.knowledge?.userDescription && <p className="mt-2 text-caption leading-4 text-[#77766f]"><span className="font-medium text-[#5b5a54]">你的说明：</span>{file.knowledge.userDescription}</p>}
                  {file.knowledge?.agentSummary && <p className="mt-1 text-caption leading-4 text-[#68776f]"><span className="font-medium text-[#4f665b]">小花摘要：</span>{file.knowledge.agentSummary}</p>}
                  <div className="mt-1.5 flex gap-2 text-caption">
                    {file.knowledge?.status === "ready" && <button type="button" aria-busy={previewLoading === file.knowledge!.documentId} disabled={Boolean(previewLoading)} onClick={() => void previewDocument(file.knowledge!.documentId)} className="text-[#587165] hover:underline disabled:opacity-40">{previewLoading === file.knowledge!.documentId ? "加载预览中…" : "预览内容"}</button>}
                    {file.sourceProvider === "feishu" && file.sourceUrl
                      ? <a href={file.sourceUrl} target="_blank" rel="noreferrer" className="text-[#66748a] hover:underline">在飞书编辑 ↗</a>
                      : !file.supersededAt && <button type="button" onClick={() => { setReplaceTargetId(file.id); replaceInputRef.current?.click(); }} className="text-[#77766f] hover:underline">上传新版本</button>}
                  </div>
                  {props.sourceProjectId && !file.supersededAt && (props.archiveProjects?.some((item) => item.id !== props.sourceProjectId) ?? false) && (
                    <div className="mt-2 flex max-w-[360px] gap-2">
                      <select aria-label={`移动 ${file.fileName} 到项目`} value={moveTargets[file.id] || ""} disabled={Boolean(movingId)} onChange={(event) => setMoveTargets((current) => ({ ...current, [file.id]: event.target.value }))} className="h-7 min-w-0 flex-1 rounded-md border border-[#e0dfda] bg-white px-2 text-caption text-[#77766f]">
                        <option value="">移动到其他项目…</option>
                        {props.archiveProjects!.filter((item) => item.id !== props.sourceProjectId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                      <button type="button" disabled={!moveTargets[file.id] || Boolean(movingId)} onClick={() => void moveFile(file)} className="h-7 rounded-md border border-[#d8ddd9] px-2.5 text-caption font-medium text-[#587165] disabled:opacity-35">{movingId === file.id ? "移动中…" : "确认移动"}</button>
                    </div>
                  )}
                </div>
                {file.sourceProvider !== "feishu" && <button
                  type="button"
                  aria-label={`删除 ${file.fileName}`}
                  aria-busy={deletingId === file.id}
                  disabled={Boolean(deletingId) || file.knowledge?.status === "processing"}
                  onClick={() => void deleteFile(file)}
                  className="grid h-7 w-7 place-items-center rounded-md text-panel-title text-[#aaa9a1] hover:bg-[#f4f1ef] hover:text-[#895c49] disabled:opacity-40"
                >
                  {deletingId === file.id ? "…" : "×"}
                </button>}
              </div>
            );
          })}
          </div>
        </div>
      )}
      <input ref={replaceInputRef} type="file" accept={acceptedExtensions} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file && replaceTargetId) void uploadFiles([{ file }], replaceTargetId); }} />
      {pendingUploads.length > 0 && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-[#161613]/20 p-8">
          <section className="panel-in flex max-h-[82vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[11px] border border-[#deddd8] bg-white shadow-[0_24px_80px_rgba(20,20,16,0.2)]">
            <header className="flex shrink-0 items-start border-b border-[#e8e7e2] px-5 py-4">
              <div>
                <h2 className="text-panel-title font-semibold text-[#2d2d29]">上传项目材料</h2>
                <p className="mt-1 text-control leading-5 text-[#929189]">补充材料说明后，所有 Agent 都能理解这份文件的用途和使用限制。</p>
              </div>
              <button type="button" disabled={isUploading} onClick={() => setPendingUploads([])} className="ml-auto grid h-7 w-7 place-items-center text-[18px] text-[#88877f] disabled:opacity-40">×</button>
            </header>
            <div className="subtle-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {pendingUploads.map((item, index) => (
                <div key={item.id} className="rounded-[8px] border border-[#e4e3de] bg-[#fafaf8] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <FileMark extension={item.file.name.split(".").pop() || "FILE"} />
                    <div className="min-w-0"><p className="truncate text-body font-medium text-[#4a4944]">原文件：{item.file.name}</p><p className="mt-0.5 text-caption text-[#aaa9a1]">{formatSize(item.file.size)}</p></div>
                    {pendingUploads.length > 1 && <button type="button" disabled={isUploading} onClick={() => setPendingUploads((current) => current.filter((entry) => entry.id !== item.id))} className="ml-auto text-caption text-[#9a6554]">移除</button>}
                  </div>
                  <label className="block text-control font-medium text-[#68675f]">资料名称
                    <input value={item.displayName} maxLength={240} disabled={isUploading} onChange={(event) => setPendingUploads((current) => current.map((entry, currentIndex) => currentIndex === index ? { ...entry, displayName: event.target.value } : entry))} className="mt-1.5 h-9 w-full rounded-md border border-[#deddd8] bg-white px-2.5 text-body outline-none focus:border-[#91a198] disabled:opacity-60" />
                  </label>
                  <label className="mt-3 block text-control font-medium text-[#68675f]">文件简介 <span className="font-normal text-[#aaa9a1]">（建议填写）</span>
                    <textarea value={item.userDescription} maxLength={8000} disabled={isUploading} onChange={(event) => setPendingUploads((current) => current.map((entry, currentIndex) => currentIndex === index ? { ...entry, userDescription: event.target.value } : entry))} placeholder="例如：这是客户确认过的最终 Brief，预算与交付时间以此为准；不要引用附录中的旧报价。" rows={3} className="mt-1.5 w-full resize-none rounded-md border border-[#deddd8] bg-white px-2.5 py-2 text-control leading-5 outline-none focus:border-[#91a198] disabled:opacity-60" />
                  </label>
                </div>
              ))}
            </div>
            <footer className="flex shrink-0 items-center justify-between border-t border-[#e8e7e2] px-5 py-3">
              <p className="text-caption text-[#aaa9a1]">上传后将自动解析并建立项目知识索引</p>
              <div className="flex gap-2">
                <button type="button" disabled={isUploading} onClick={() => setPendingUploads([])} className="h-8 px-3 text-control text-[#77766f] disabled:opacity-40">取消</button>
                <button type="button" aria-busy={isUploading} disabled={isUploading || pendingUploads.some((item) => !item.displayName.trim())} onClick={() => void uploadFiles(pendingUploads)} className="h-8 rounded-md bg-[#243f34] px-3 text-control font-medium text-white disabled:opacity-40">{isUploading ? "正在上传…" : `确认上传${pendingUploads.length > 1 ? ` ${pendingUploads.length} 个文件` : ""}`}</button>
              </div>
            </footer>
          </section>
        </div>
      )}
      {previewLoading && <p role="status" className="mt-4 text-control text-[#999890]"><span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#557267]" />正在加载解析内容…</p>}
      {preview && <div className="fixed inset-0 z-[80] grid place-items-center bg-[#161613]/20 p-8"><section className="flex max-h-[82vh] w-[720px] flex-col overflow-hidden rounded-[11px] border border-[#deddd8] bg-white shadow-[0_24px_80px_rgba(20,20,16,0.2)]"><header className="flex h-14 shrink-0 items-center border-b border-[#e8e7e2] px-4"><div><p className="text-body font-semibold text-[#34342f]">{preview.document.fileName}</p><p className="mt-0.5 text-micro text-[#999890]">{preview.document.pageCount || 0} 页 · {preview.document.chunkCount} 个知识片段</p></div><a href={preview.document.fileUrl} target="_blank" rel="noreferrer" className="ml-auto mr-2 text-caption text-[#587165]">打开原文件 ↗</a><button type="button" onClick={() => setPreview(null)} className="grid h-7 w-7 place-items-center text-[17px] text-[#88877f]">×</button></header><div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto p-4">{preview.chunks.map((chunk) => <article key={chunk.id} className="mb-3 rounded-[7px] border border-[#e5e4df] bg-[#fafaf8] p-3"><p className="mb-2 text-micro font-medium text-[#89958f]">{chunk.page_number ? `第 ${chunk.page_number} 页` : chunk.section_title || "文本片段"}</p><p className="whitespace-pre-wrap text-control leading-[1.7] text-[#55554f]">{chunk.content}</p></article>)}</div></section></div>}
    </div>
  );
}
