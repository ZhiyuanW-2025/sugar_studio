"use client";
/* eslint-disable react-hooks/set-state-in-effect, @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentAttachment, AgentSendResult } from "./types";
import type { DesignVisualSource, ImageGenerationSummary } from "../lib/image-generation/types";
import type { ImageQuality, ImageSize } from "../lib/image-generation/catalog";
import { MaterialDestinationModal, type MaterialDestination } from "./MaterialDestinationModal";
import { insertTextareaNewline } from "../lib/ui/textarea-keyboard";

type Source = DesignVisualSource & { summary?: string | null; modifiedAt?: string | null };

export type DesignDraft = { prompt: string; sources?: Source[]; nonce: number };

type Props = {
  projectId: string | null;
  disabled: boolean;
  draft?: DesignDraft | null;
  onDraftConsumed?: () => void;
  onSend: (message: string, attachments?: AgentAttachment[]) => Promise<AgentSendResult>;
  onNotice: (message: string) => void;
  promptValue?: string;
  onPromptValueChange?: (value: string) => void;
};

const sizes: Array<{ value: ImageSize; label: string }> = [
  { value: "1024x1024", label: "方形 1:1" },
  { value: "1536x1024", label: "横版 3:2" },
  { value: "1024x1536", label: "竖版 2:3" },
];
const qualities: Array<{ value: ImageQuality; label: string }> = [
  { value: "low", label: "快速" }, { value: "medium", label: "标准" }, { value: "high", label: "精细" },
];
const acceptedDesignFiles = ".pdf,.docx,.pptx,.xlsx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.m4v,.webm,.mp3,.wav,.m4a,.aac,.flac,.ogg";
const allowedDesignExtensions = new Set(acceptedDesignFiles.split(",").map((item) => item.slice(1)));
const directlyEditableImageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);
const maxAttachments = 5;
const maxVisualSources = 5;
const maxFileSize = 25 * 1024 * 1024;

function fileSizeLabel(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function elapsed(item: ImageGenerationSummary) {
  if (!item.completedAt) return null;
  const seconds = Math.max(0, Date.parse(item.completedAt) - Date.parse(item.createdAt)) / 1000;
  return seconds < 60 ? `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒` : `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
}

export function DesignImagePanel({ projectId, disabled, draft, onDraftConsumed, onSend, onNotice, promptValue, onPromptValueChange }: Props) {
  const [mode, setMode] = useState<"chat" | "generate">("generate");
  const [localPrompt, setLocalPrompt] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [available, setAvailable] = useState<Source[]>([]);
  const [generations, setGenerations] = useState<ImageGenerationSummary[]>([]);
  const [size, setSize] = useState<ImageSize>("1024x1024");
  const [quality, setQuality] = useState<ImageQuality>("medium");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedProjectSourceIds, setSelectedProjectSourceIds] = useState<string[]>([]);
  const [choosingDestinationFor, setChoosingDestinationFor] = useState<string>();
  const [lightbox, setLightbox] = useState<ImageGenerationSummary>();
  const [publishing, setPublishing] = useState<ImageGenerationSummary>();
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const prompt = promptValue ?? localPrompt;
  const setPrompt = (value: string) => {
    if (onPromptValueChange) onPromptValueChange(value);
    else setLocalPrompt(value);
  };

  const load = useCallback(async () => {
    if (!projectId) return;
    const [sourceResponse, generationResponse] = await Promise.all([
      fetch(`/api/agents/design/sources?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
      fetch(`/api/agents/design/images?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
    ]);
    const sourcePayload = await sourceResponse.json().catch(() => null) as { sources?: Source[] } | null;
    const generationPayload = await generationResponse.json().catch(() => null) as { generations?: ImageGenerationSummary[] } | null;
    if (sourceResponse.ok) setAvailable(sourcePayload?.sources ?? []);
    if (generationResponse.ok) setGenerations(generationPayload?.generations ?? []);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!draft) return;
    setMode("generate");
    setPrompt(draft.prompt);
    setSources(draft.sources ?? []);
    onDraftConsumed?.();
  }, [draft?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const addExternalFiles = async (files: File[]) => {
    if (!projectId || busy || files.length === 0) return;
    setBusy(true); setError(undefined);
    try {
      const imageFiles: File[] = [];
      const knowledgeFiles: File[] = [];
      for (const file of files) {
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!allowedDesignExtensions.has(extension)) throw new Error(`暂不支持「${file.name}」的文件格式。`);
        if (file.size <= 0 || file.size > maxFileSize) throw new Error(`「${file.name}」必须小于 25 MB。`);
        if (directlyEditableImageExtensions.has(extension)) imageFiles.push(file);
        else knowledgeFiles.push(file);
      }
      if (sources.length + imageFiles.length > maxVisualSources) throw new Error(`生图参考图片最多选择 ${maxVisualSources} 张。`);
      if (attachments.length + knowledgeFiles.length > maxAttachments) throw new Error(`普通附件最多添加 ${maxAttachments} 个。`);

      const uploadedSources: Source[] = [];
      for (const file of imageFiles) {
        const form = new FormData(); form.set("projectId", projectId); form.set("file", file);
        const response = await fetch("/api/agents/design/sources", { method: "POST", body: form });
        const payload = await response.json().catch(() => null) as { source?: Source; error?: string } | null;
        if (!response.ok || !payload?.source) throw new Error(payload?.error || `「${file.name}」上传失败。`);
        uploadedSources.push(payload.source);
      }
      if (uploadedSources.length > 0) {
        setSources((current) => [...current, ...uploadedSources].slice(0, maxVisualSources));
        setAvailable((current) => [...uploadedSources, ...current]);
      }
      if (knowledgeFiles.length > 0) {
        setAttachments((current) => [...current, ...knowledgeFiles.map((file) => ({ id: crypto.randomUUID(), file, saveToFeishu: false }))].slice(0, maxAttachments));
      }
    } catch (value) { setError(value instanceof Error ? value.message : "文件添加失败。"); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const openProjectPicker = () => {
    setSelectedProjectSourceIds(sources.filter((item) => item.kind === "feishu_drive").map((item) => item.id));
    setPickerOpen(true);
  };

  const confirmProjectSources = () => {
    const retained = sources.filter((item) => item.kind !== "feishu_drive");
    const selected = available.filter((item) => item.kind === "feishu_drive" && selectedProjectSourceIds.includes(item.id));
    if (retained.length + selected.length > maxVisualSources) {
      setError(`生图参考图片最多选择 ${maxVisualSources} 张。`);
      return;
    }
    setSources([...retained, ...selected]);
    setPickerOpen(false);
  };

  const sourceFiles = async (): Promise<AgentAttachment[]> => Promise.all(sources.map(async (source) => {
    const url = source.previewUrl || `/api/agents/design/sources?projectId=${encodeURIComponent(projectId!)}&contentKind=${source.kind}&contentId=${source.id}`;
    const response = await fetch(url); if (!response.ok) throw new Error(`无法读取参考图「${source.name}」。`);
    const blob = await response.blob();
    return { id: crypto.randomUUID(), file: new File([blob], source.name, { type: blob.type }), saveToFeishu: false };
  }));

  const sendChat = async () => {
    if ((!prompt.trim() && sources.length === 0 && attachments.length === 0) || busy || disabled) return;
    setBusy(true); setError(undefined);
    try {
      const marker = sources.length ? `\n[[sugar_visual_sources:${encodeURIComponent(JSON.stringify(sources.map(({ kind, id, name, path, previewUrl }) => ({ kind, id, name, path, previewUrl }))))}]]` : "";
      const visualFiles = await sourceFiles();
      const result = await onSend(`${prompt.trim() || "请分析我选择的参考文件。"}${marker}`, [...visualFiles, ...attachments]);
      if (result.sent) { setPrompt(""); setSources([]); }
      if (result.attachmentsAccepted) setAttachments([]);
    } catch (value) { setError(value instanceof Error ? value.message : "发送失败。"); }
    finally { setBusy(false); }
  };

  const generate = async () => {
    if (!projectId || !prompt.trim() || busy || disabled) return;
    setBusy(true); setError(undefined);
    const batchId = crypto.randomUUID();
    const created: ImageGenerationSummary[] = [];
    try {
      let generationPrompt = prompt.trim();
      if (attachments.length > 0) {
        const result = await onSend(
          `请阅读本轮附件，并结合下面的要求整理成一份可直接用于图片生成的完整视觉指令。只使用附件中能够确认的信息，不要猜测。\n\n原始生图要求：\n${generationPrompt}`,
          attachments,
        );
        if (!result.sent) throw new Error("小熊未能读取附件，本次尚未开始作画。");
        if (result.attachmentsAccepted) setAttachments([]);
        if (result.reply?.trim()) generationPrompt = result.reply.trim();
      }
      for (let index = 0; index < count; index += 1) {
        const response = await fetch("/api/agents/design/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          projectId, requestId: crypto.randomUUID(), batchId, batchIndex: index, prompt: generationPrompt, size, quality,
          operation: sources.length ? "edit" : "generate",
          sources: sources.map(({ kind, id }) => ({ kind, id })),
        }) });
        const payload = await response.json().catch(() => null) as { generation?: ImageGenerationSummary; error?: string } | null;
        if (!response.ok || !payload?.generation) throw new Error(payload?.error || "图片生成失败。");
        created.push(payload.generation);
      }
      setGenerations((current) => [...created.reverse(), ...current]);
      setPrompt(""); setSources([]); onNotice(`小熊完成了 ${created.length} 张图片`);
    } catch (value) {
      if (created.length > 0) setGenerations((current) => [...created.reverse(), ...current]);
      setError(`${value instanceof Error ? value.message : "图片生成失败。"}${created.length > 0 ? ` 已保留先完成的 ${created.length} 张。` : ""}`);
    }
    finally { setBusy(false); }
  };

  const publish = async (destination: MaterialDestination) => {
    if (!projectId || !publishing?.imageUrl) return;
    setBusy(true); setError(undefined);
    try {
      const image = await fetch(publishing.imageUrl).then((response) => response.blob());
      const form = new FormData();
      form.set("projectId", projectId); form.set("scopeId", destination.scopeId);
      if (destination.parentToken) form.set("parentToken", destination.parentToken);
      form.set("file", new File([image], `小熊-${publishing.id.slice(0, 8)}.png`, { type: image.type || "image/png" }));
      const response = await fetch("/api/projects/materials/upload", { method: "POST", body: form });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "上传飞书云盘失败。");
      setPublishing(undefined); onNotice("图片已加入飞书云盘"); await load();
    } catch (value) { setError(value instanceof Error ? value.message : "上传飞书云盘失败。"); }
    finally { setBusy(false); }
  };

  const visible = useMemo(() => generations.filter((item) => item.status === "completed" && item.imageUrl), [generations]);

  return <>
    {visible.length > 0 && <div className="mx-5 mb-3 border-t border-[#ecebe7] pt-4">
      <div className="mb-2 text-control font-medium text-[#77766f]">图片成果</div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">{visible.slice(0, 12).map((item) => <article key={item.id} className="overflow-hidden rounded-[8px] border border-[#e2e1dc] bg-white">
        <img src={item.imageUrl!} alt={item.prompt} className="aspect-square w-full cursor-zoom-in object-cover" onClick={() => setLightbox(item)} />
        <div className="space-y-2 p-3"><p className="line-clamp-2 text-body text-[#676760]">{item.prompt}</p>
          <div className="text-micro text-[#aaa9a1]">{item.size} · {elapsed(item) ? `用时 ${elapsed(item)}` : item.model}</div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => { setMode("generate"); setSources([{ kind: "generation", id: item.id, name: `小熊作品 ${item.id.slice(0, 8)}`, previewUrl: item.imageUrl }]); setPrompt(`请基于这张图片继续修改：${item.prompt}`); }} className="rounded-md border border-[#d8ddd9] px-2.5 py-1.5 text-control text-[#486457]">引用继续加工</button>
            <button type="button" onClick={() => setPublishing(item)} className="rounded-md border border-[#d8ddd9] px-2.5 py-1.5 text-control text-[#486457]">加入飞书云盘</button>
            {item.downloadUrl && <a href={item.downloadUrl} className="rounded-md border border-[#deddd7] px-2.5 py-1.5 text-control text-[#66665f]">下载</a>}
            <button type="button" onClick={() => setLightbox(item)} className="rounded-md border border-[#deddd7] px-2.5 py-1.5 text-control text-[#66665f]">看大图</button>
          </div>
        </div>
      </article>)}</div>
    </div>}

    <div className="mx-4 mb-4 overflow-hidden rounded-[10px] border border-[#deddd7] bg-white shadow-[0_1px_2px_rgba(25,25,20,0.04)]">
      <div className="flex border-b border-[#ecebe7] bg-[#f7f7f4] p-1">
        <button type="button" onClick={() => setMode("generate")} className={`h-7 flex-1 rounded-md text-control ${mode === "generate" ? "bg-white font-medium text-[#34342f] shadow-sm" : "text-[#88877f]"}`}>生成图片</button>
        <button type="button" onClick={() => setMode("chat")} className={`h-7 flex-1 rounded-md text-control ${mode === "chat" ? "bg-white font-medium text-[#34342f] shadow-sm" : "text-[#88877f]"}`}>只聊不画</button>
      </div>
      {sources.length > 0 && <div className="flex gap-2 overflow-x-auto border-b border-[#efeee9] px-3 py-2">{sources.map((source) => <div key={`${source.kind}:${source.id}`} className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#dce2de] bg-[#f5f8f6] p-1.5">
        {source.previewUrl && <img src={source.previewUrl} alt="" className="h-8 w-8 rounded object-cover" />}
        <span className="max-w-[160px] truncate text-caption text-[#52645b]">{source.name}</span><button type="button" onClick={() => setSources((current) => current.filter((item) => item !== source))} className="px-1 text-[#8d938e]">×</button>
      </div>)}</div>}
      {attachments.length > 0 && <div className="space-y-1.5 border-b border-[#efeee9] px-3 py-2">{attachments.map((attachment) => <div key={attachment.id} className="flex items-center gap-1.5 rounded-md border border-[#e1e3df] bg-[#fafaf8] px-2 py-1.5 text-caption text-[#66665f]">
        <span className="max-w-[220px] flex-1 truncate font-medium">{attachment.file.name}</span>
        <span className="shrink-0 text-[#aaa9a1]">{fileSizeLabel(attachment.file.size)}</span>
        <button type="button" disabled={busy} onClick={() => setChoosingDestinationFor(attachment.id)} className={`h-6 max-w-[180px] truncate rounded-md border px-2 ${attachment.saveToFeishu ? "border-[#bfd0c6] bg-white text-[#527063]" : "border-[#deddd7] bg-white text-[#85857e]"}`}>
          {attachment.saveToFeishu ? `保存到：${attachment.materialDestinationLabel}` : "仅用于本次对话 ▾"}
        </button>
        <button type="button" disabled={busy} aria-label={`移除附件 ${attachment.file.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} className="px-1 text-body text-[#999890]">×</button>
      </div>)}</div>}
      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={disabled || busy} rows={3} placeholder={mode === "chat" ? "和小熊讨论视觉方案，或加入参考图…" : "描述要画什么、用途、风格，以及必须保留或避免的内容…"} onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          insertTextareaNewline(event.currentTarget, prompt, setPrompt);
          return;
        }
        event.preventDefault(); void (mode === "chat" ? sendChat() : generate());
      }} className="block h-[76px] w-full resize-none bg-transparent px-3.5 py-3 text-body leading-5 outline-none placeholder:text-[#aaa9a1]" />
      {mode === "generate" && <div className="flex flex-wrap items-center gap-2 border-t border-[#efeee9] px-3 py-2">
        <select value={size} onChange={(event) => setSize(event.target.value as ImageSize)} className="h-8 rounded-md border border-[#deddd7] bg-white px-2.5 text-control">{sizes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <select value={quality} onChange={(event) => setQuality(event.target.value as ImageQuality)} className="h-8 rounded-md border border-[#deddd7] bg-white px-2.5 text-control">{qualities.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <select value={count} onChange={(event) => setCount(Number(event.target.value))} className="h-8 rounded-md border border-[#deddd7] bg-white px-2.5 text-control">{[1,2,3,4].map((value) => <option key={value} value={value}>{value} 张</option>)}</select>
      </div>}
      {error && <p role="alert" className="px-3 pb-2 text-caption text-[#98584b]">{error}</p>}
      <div className="flex h-10 items-center gap-1.5 border-t border-[#efeee9] px-2.5">
        <button type="button" onClick={openProjectPicker} disabled={!projectId || busy} className="h-8 rounded-md border border-[#deddd7] px-2.5 text-control text-[#66665f] disabled:opacity-40">＋ 项目内图片</button>
        <label className={`h-8 cursor-pointer rounded-md border border-[#deddd7] px-2.5 text-control leading-8 text-[#66665f] ${busy ? "pointer-events-none opacity-40" : ""}`}>＋ 上传文件<input ref={fileRef} type="file" multiple accept={acceptedDesignFiles} className="sr-only" onChange={(event) => void addExternalFiles(Array.from(event.target.files ?? []))} /></label>
        <span className="ml-1 hidden text-micro text-[#aaa9a1] lg:inline">Enter 发送 · Option/Alt + Enter 换行</span>
        <button type="button" onClick={() => void (mode === "chat" ? sendChat() : generate())} disabled={disabled || busy || (!prompt.trim() && (mode === "generate" || (sources.length === 0 && attachments.length === 0)))} className="ml-auto h-8 rounded-md bg-[#243f34] px-3.5 text-control font-medium text-white disabled:opacity-35">{busy ? "处理中…" : mode === "chat" ? "发送" : "开始作画"}</button>
      </div>
    </div>

    {pickerOpen && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/20 p-5"><div className="max-h-[75vh] w-full max-w-[640px] overflow-hidden rounded-xl border border-[#deddd7] bg-white shadow-2xl">
      <header className="flex items-center border-b border-[#ecebe7] px-5 py-4"><div><h3 className="text-panel-title font-semibold">选择项目内图片</h3><p className="mt-1 text-caption text-[#999890]">来自当前项目飞书云盘，按飞书目录显示</p></div><button type="button" onClick={() => setPickerOpen(false)} className="ml-auto text-[18px] text-[#999890]">×</button></header>
      <div className="subtle-scrollbar max-h-[55vh] overflow-y-auto p-4">{available.filter((item) => item.kind === "feishu_drive").length === 0 ? <div className="rounded-md bg-[#f7f7f4] px-4 py-8 text-center text-control text-[#999890]">当前飞书云盘索引中没有 PNG、JPEG 或 WebP 图片。请先在“项目材料”同步云盘。</div> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{available.filter((item) => item.kind === "feishu_drive").map((source) => {
        const selected = selectedProjectSourceIds.includes(source.id);
        return <button key={source.id} type="button" onClick={() => setSelectedProjectSourceIds((current) => current.includes(source.id) ? current.filter((id) => id !== source.id) : current.length < maxVisualSources ? [...current, source.id] : current)} className={`relative overflow-hidden rounded-md border text-left ${selected ? "border-[#5d806f] ring-2 ring-[#5d806f]/15" : "border-[#e2e1dc] hover:border-[#9caf9f]"}`}>
          <img src={source.previewUrl!} alt="" className="aspect-[4/3] w-full bg-[#f3f3ef] object-cover" loading="lazy" />
          <span className={`absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full border text-control ${selected ? "border-[#5d806f] bg-[#5d806f] text-white" : "border-white bg-white/85 text-transparent"}`}>✓</span>
          <div className="p-2"><p className="truncate text-caption font-medium text-[#55554f]">{source.name}</p><p className="mt-1 truncate text-micro text-[#aaa9a1]">{source.path || "飞书云盘"}</p></div>
        </button>;
      })}</div>}</div>
      <footer className="flex items-center border-t border-[#ecebe7] px-4 py-3"><span className="text-caption text-[#999890]">已选 {selectedProjectSourceIds.length}/{maxVisualSources} 张</span><button type="button" onClick={() => setPickerOpen(false)} className="ml-auto h-8 rounded-md px-3 text-control text-[#77766f]">取消</button><button type="button" onClick={confirmProjectSources} className="ml-2 h-8 rounded-md bg-[#243f34] px-4 text-control font-medium text-white">确认选择</button></footer>
    </div></div>}
    {lightbox?.imageUrl && <div className="fixed inset-0 z-[110] grid place-items-center bg-black/80 p-6" onClick={() => setLightbox(undefined)}><button type="button" className="absolute right-6 top-5 text-3xl text-white">×</button><img src={lightbox.imageUrl} alt={lightbox.prompt} className="max-h-[90vh] max-w-[92vw] object-contain" /></div>}
    {publishing && projectId && <MaterialDestinationModal projectId={projectId} fileName={`小熊-${publishing.id.slice(0,8)}.png`} fixedTarget="drive" onCancel={() => setPublishing(undefined)} onConfirm={(destination) => void publish(destination)} />}
    {choosingDestinationFor && projectId && (() => {
      const attachment = attachments.find((item) => item.id === choosingDestinationFor);
      return attachment ? <MaterialDestinationModal
        projectId={projectId}
        fileName={attachment.file.name}
        onCancel={() => setChoosingDestinationFor(undefined)}
        onUseConversationOnly={() => {
          setAttachments((current) => current.map((item) => item.id === attachment.id ? { id: item.id, file: item.file, saveToFeishu: false } : item));
          setChoosingDestinationFor(undefined);
        }}
        onConfirm={(destination) => {
          setAttachments((current) => current.map((item) => item.id === attachment.id ? {
            ...item,
            saveToFeishu: true,
            materialTarget: destination.target,
            materialScopeId: destination.scopeId,
            materialParentToken: destination.parentToken,
            materialDestinationLabel: destination.label,
          } : item));
          setChoosingDestinationFor(undefined);
        }}
      /> : null;
    })()}
  </>;
}
