/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { agentMeta } from "./mockData";
import type { AgentAttachment, AgentId, AgentSendResult, AgentTask, ChatMessage } from "./types";
import { CodingRunsPanel } from "./CodingRunsPanel";
import { ClientDeliveryPanel } from "./ClientDeliveryPanel";
import { DesignImagePanel, type DesignDraft } from "./DesignImagePanel";
import { ConversationBar } from "./ConversationBar";
import { FeishuChangeProposals } from "./FeishuChangeProposals";
import { FeishuPublishButton } from "./FeishuPublishButton";
import { MaterialDestinationModal, type MaterialDestination } from "./MaterialDestinationModal";
import type { CodingRunView } from "../lib/coding-runs/types";
import { progressCategories, progressCategoryLabels, type ProgressCategory } from "../lib/projects/progress-events";
import { AgentAvatar } from "./AgentAvatar";
import { insertTextareaNewline } from "../lib/ui/textarea-keyboard";
import { MarkdownMessage } from "./MarkdownMessage";

type AgentPanelProps = {
  agentId: AgentId;
  messages: ChatMessage[];
  tasks: AgentTask[];
  saved: boolean;
  onSave: () => void;
  onHandoff: (target: "coder" | "designer") => void;
  onClose: () => void;
  canClose?: boolean;
  onSendMessage: (agentId: AgentId, message: string, attachments?: AgentAttachment[]) => Promise<AgentSendResult>;
  isGenerating: boolean;
  error?: string;
  isLoadingHistory: boolean;
  projectId: string | null;
  onNotice: (message: string) => void;
  conversationId?: string;
  onConversationChange: (agentId: AgentId, conversationId: string) => void;
  onReturnHandoff: (source: AgentId, target: AgentId, content: string) => void;
  onCodingReply: (message: ChatMessage) => void;
  onCodingExecutionState: (working: boolean, error?: string) => void;
  isPreparingSave?: boolean;
  preparingHandoff?: "coder" | "designer" | null;
  progressMessage?: string;
  startedAt?: number;
  composerValue?: string;
  onComposerValueChange?: (value: string) => void;
};

const acceptedKnowledgeFiles = ".pdf,.docx,.pptx,.xlsx,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.m4v,.webm,.mp3,.wav,.m4a,.aac,.flac,.ogg";
const allowedKnowledgeExtensions = new Set(acceptedKnowledgeFiles.split(",").map((item) => item.slice(1)));
const maxKnowledgeFileSize = 25 * 1024 * 1024;
const maxComposerAttachments = 5;

function cleanCodexCompletionForDisplay(content: string) {
  const result: string[] = [];
  let skippingVerification = false;
  for (const line of content.split("\n")) {
    if (/^\s*验证[：:]/.test(line)) {
      skippingVerification = true;
      continue;
    }
    if (skippingVerification) {
      if (!line.trim() || /^\s*[-*]\s+/.test(line)) continue;
      skippingVerification = false;
    }
    if (/^\s*当前[^\n]*(?:Commit|Push)[^\n]*[。.]?\s*$/i.test(line)) continue;
    result.push(line);
  }
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function fileSizeLabel(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatElapsedTime(durationMs: number) {
  const totalSeconds = Math.max(0, durationMs) / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes} 分 ${seconds} 秒`;
}

function AgentComposer({
  agentId,
  onSend,
  disabled,
  projectId,
  controlledValue,
  onControlledValueChange,
}: {
  agentId: AgentId;
  onSend: (message: string, attachments?: AgentAttachment[]) => Promise<AgentSendResult>;
  disabled: boolean;
  projectId: string | null;
  controlledValue?: string;
  onControlledValueChange?: (value: string) => void;
}) {
  const [localValue, setLocalValue] = useState("");
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [choosingDestinationFor, setChoosingDestinationFor] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const meta = agentMeta[agentId];
  const value = controlledValue ?? localValue;
  const updateValue = (next: string) => onControlledValueChange ? onControlledValueChange(next) : setLocalValue(next);

  const submit = async () => {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || disabled || submitting) return;
    setSubmitting(true);
    try {
      const result = await onSend(trimmed, attachments);
      if (result.attachmentsAccepted) setAttachments([]);
      if (result.sent) updateValue("");
    } finally {
      setSubmitting(false);
    }
  };

  const addAttachments = (files: File[]) => {
    setAttachmentError(undefined);
    const next: AgentAttachment[] = [];
    for (const file of files) {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!allowedKnowledgeExtensions.has(extension)) {
        setAttachmentError(`暂不支持「${file.name}」的文件格式。`);
        continue;
      }
      const sizeLimit = maxKnowledgeFileSize;
      if (file.size <= 0 || file.size > sizeLimit) {
        setAttachmentError(`「${file.name}」必须小于 25 MB。`);
        continue;
      }
      next.push({ id: crypto.randomUUID(), file, saveToFeishu: false });
    }
    setAttachments((current) => {
      const available = Math.max(0, maxComposerAttachments - current.length);
      if (next.length > available) setAttachmentError(`一次最多添加 ${maxComposerAttachments} 个文件。`);
      return [...current, ...next.slice(0, available)];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const composerDisabled = disabled || submitting;

  return (
    <div className="mx-4 mb-4 rounded-[10px] border border-[#deddd7] bg-white shadow-[0_1px_2px_rgba(25,25,20,0.04)] focus-within:border-[#aaa9a1] focus-within:shadow-[0_0_0_3px_rgba(20,20,18,0.035)]">
      <textarea
        value={value}
        disabled={composerDisabled}
        onChange={(event) => updateValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          const nativeEvent = event.nativeEvent;
          if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return;
          if (event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            insertTextareaNewline(event.currentTarget, value, updateValue);
            return;
          }
          event.preventDefault();
          void submit();
        }}
        rows={2}
        aria-label={`给${meta.name}发消息`}
        placeholder={composerDisabled
          ? `${agentId === "coder" ? "Codex" : meta.name}正在生成回复…`
          : agentId === "coder"
            ? "和牛牛讨论，确认后可直接让 Codex 修改代码…"
            : `给${meta.name}发送消息…`}
        className="block h-[62px] w-full resize-none bg-transparent px-3.5 pt-3 text-body text-[#34342f] outline-none placeholder:text-[#92918a]"
      />
      {attachments.length > 0 && (
        <div className="space-y-1.5 border-t border-[#efeee9] px-3 pt-2.5">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="flex max-w-full items-center gap-1.5 rounded-[6px] border border-[#dde3df] bg-[#f5f8f6] px-2 py-1 text-caption text-[#58665f]">
              <span className="max-w-[180px] flex-1 truncate font-medium">{attachment.file.name}</span>
              <span className="shrink-0 text-[#999f9a]">{fileSizeLabel(attachment.file.size)}</span>
              <button type="button" disabled={composerDisabled} onClick={() => setChoosingDestinationFor(attachment.id)} className={`h-6 max-w-[190px] truncate rounded-md border px-2 text-caption ${attachment.saveToFeishu ? "border-[#bfd0c6] bg-white text-[#527063]" : "border-[#d9dfdb] bg-white text-[#7b817c]"}`}>
                {attachment.saveToFeishu ? `保存到：${attachment.materialDestinationLabel}` : "仅用于本次对话 ▾"}
              </button>
              <button type="button" aria-label={`移除附件 ${attachment.file.name}`} disabled={composerDisabled} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} className="ml-0.5 text-body leading-none text-[#90968f] hover:text-[#5d625e]">×</button>
            </div>
          ))}
          <p className="pb-1 text-caption text-[#999f9a]">文件默认只用于本次对话；需要成为正式项目材料时，请先选择飞书保存位置。</p>
        </div>
      )}
      {attachmentError && <p role="alert" className="px-3 pt-2 text-caption text-[#98584b]">{attachmentError}</p>}
      <div className="flex h-8 items-center px-2.5 pb-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <label className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-panel-title text-[#77766f] hover:bg-[#f1f1ed] ${composerDisabled ? "pointer-events-none opacity-35" : ""}`} title="添加 PDF、图片或知识文件">
            <span aria-hidden="true">＋</span>
            <input ref={fileInputRef} type="file" multiple accept={acceptedKnowledgeFiles} disabled={composerDisabled} className="sr-only" aria-label="添加 PDF、图片或知识文件" onChange={(event) => addAttachments(Array.from(event.target.files ?? []))} />
          </label>
          <span className="truncate text-caption text-[#b1b0a8]">Enter 发送 · Option/Alt + Enter 换行 · 最多 5 个附件</span>
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={composerDisabled || (!value.trim() && attachments.length === 0)}
          aria-busy={composerDisabled}
          aria-label="发送消息"
          className="ml-auto grid h-6 w-6 place-items-center rounded-md bg-[#22221f] text-body text-white transition-opacity disabled:opacity-25"
        >
          {composerDisabled ? "…" : "↑"}
        </button>
      </div>
      {choosingDestinationFor && projectId && (() => {
        const attachment = attachments.find((item) => item.id === choosingDestinationFor);
        return attachment ? <MaterialDestinationModal
          projectId={projectId}
          fileName={attachment.file.name}
          onCancel={() => setChoosingDestinationFor(undefined)}
          onUseConversationOnly={() => {
            setAttachments((current) => current.map((item) => item.id === attachment.id ? {
              id: item.id,
              file: item.file,
              saveToFeishu: false,
            } : item));
            setChoosingDestinationFor(undefined);
          }}
          onConfirm={(destination: MaterialDestination) => {
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
    </div>
  );
}

function CoderGitControls({
  projectId,
  disabled,
  onNotice,
}: {
  projectId: string | null;
  disabled: boolean;
  onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState<"push" | "sync">();
  const [error, setError] = useState<string>();

  const runAction = async (action: "push" | "sync") => {
    if (!projectId || disabled || busy) return;
    setBusy(action);
    setError(undefined);
    try {
      const response = await fetch("/api/projects/repository/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action, confirmed: true }),
      });
      const payload = await response.json().catch(() => null) as {
        result?: { status?: { remoteName?: string; currentBranch?: string; defaultBranch?: string | null } };
        error?: string;
      } | null;
      if (!response.ok || !payload?.result) {
        throw new Error(payload?.error || (action === "push" ? "同步至远端分支失败。" : "合并远端主干失败。"));
      }
      const status = payload.result.status;
      if (action === "push") {
        onNotice(status?.remoteName && status.currentBranch
          ? `已同步至远端：${status.remoteName}/${status.currentBranch}`
          : "已同步至远端我的分支");
      } else {
        onNotice(status?.defaultBranch && status.currentBranch
          ? `已将远端主干 ${status.defaultBranch} 合并到 ${status.currentBranch}`
          : "已拉取远端主干并合并到我的分支");
      }
      window.dispatchEvent(new Event("sugar:coding-runs-changed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Git 操作失败。");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="mx-4 mb-2 rounded-[9px] border border-[#e2e1dc] bg-[#fafaf8] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-busy={busy === "push"}
          disabled={!projectId || disabled || Boolean(busy)}
          onClick={() => void runAction("push")}
          className="h-7 rounded-md border border-[#bfd0c6] bg-[#253d33] px-3 text-control font-medium text-white hover:bg-[#1d3129] disabled:opacity-40"
        >
          {busy === "push" ? "正在同步远端…" : "【Push】同步至远端我的分支"}
        </button>
        <button
          type="button"
          aria-busy={busy === "sync"}
          disabled={!projectId || disabled || Boolean(busy)}
          onClick={() => void runAction("sync")}
          className="h-7 rounded-md border border-[#cfd5d1] bg-white px-3 text-control font-medium text-[#496357] hover:bg-[#f3f6f4] disabled:opacity-40"
        >
          {busy === "sync" ? "正在拉取并合并…" : "【Sync】拉取主干合并到我的分支"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-control leading-5 text-[#98584b]">{error}</p>}
    </div>
  );
}

function TaskCard({ task }: { task: AgentTask }) {
  const [expanded, setExpanded] = useState(false);
  const from = agentMeta[task.from];
  return (
    <div className="mb-5 overflow-hidden rounded-[9px] border border-[#d9e6df] bg-[#f4f8f6]">
      <div className="border-b border-[#dfeae4] px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-control font-medium uppercase tracking-[0.1em] text-[#557267]">
          <AgentAvatar agentId={task.from} initials={from.initials} className="grid h-5 w-5 place-items-center rounded-full bg-[#dbe9e2] text-caption font-semibold text-[#3b6253]" />
          来自{from.name}的新任务
        </div>
      </div>
      <div className="px-3.5 py-3">
        <p className="text-body font-semibold tracking-[-0.01em] text-[#25352f]">{task.title}</p>
        {expanded && (
          <pre className="mt-3 whitespace-pre-wrap border-t border-[#dfeae4] pt-3 font-sans text-body leading-[1.7] text-[#5f6d67]">
            {task.content}
          </pre>
        )}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2.5 text-body font-medium text-[#3f6b5a] hover:text-[#274d3e]"
        >
          {expanded ? "收起任务" : "查看完整任务"} <span aria-hidden="true">{expanded ? "↑" : "↗"}</span>
        </button>
      </div>
    </div>
  );
}

function MessageActionsMenu({
  agentId,
  message,
  projectId,
  saved,
  isPreparingSave,
  preparingHandoff,
  onSave,
  onHandoff,
  onReturnHandoff,
  onNotice,
  enableWorkflowActions,
}: {
  agentId: AgentId;
  message: ChatMessage;
  projectId: string | null;
  saved: boolean;
  isPreparingSave: boolean;
  preparingHandoff: "coder" | "designer" | null;
  onSave: () => void;
  onHandoff: (target: "coder" | "designer") => void;
  onReturnHandoff: (source: AgentId, target: AgentId, content: string) => void;
  onNotice: (message: string) => void;
  enableWorkflowActions: boolean;
}) {
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordSummary, setRecordSummary] = useState("");
  const [recordCategory, setRecordCategory] = useState<ProgressCategory>(
    agentId === "planner" ? "decision" : agentId === "coder" ? "execution" : agentId === "buyer" || agentId === "marketing" ? "external" : "material",
  );
  const [recording, setRecording] = useState(false);

  const openRecord = () => {
    setRecordSummary(message.body.replace(/\s+/g, " ").trim().slice(0, 180));
    setRecordOpen(true);
  };

  const saveProgress = async () => {
    if (!projectId || recording || recordSummary.trim().length < 3) return;
    setRecording(true);
    try {
      const response = await fetch("/api/projects/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, sourceMessageId: message.id, summary: recordSummary, category: recordCategory }),
      });
      const payload = await response.json().catch(() => null) as { created?: boolean; error?: string } | null;
      if (!response.ok || !payload?.created) throw new Error(payload?.error || "暂时无法记录项目进展。");
      setRecordOpen(false);
      onNotice("已记录为项目进展");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "暂时无法记录项目进展。");
    } finally { setRecording(false); }
  };

  return (
    <><details className="group relative ml-7 mt-2 w-fit">
      <summary className="grid h-6 w-7 cursor-pointer list-none place-items-center rounded-md text-body tracking-[0.08em] text-[#aaa9a1] hover:bg-[#f3f3f0] hover:text-[#6f6e67] [&::-webkit-details-marker]:hidden" aria-label="更多回复操作">
        ···
      </summary>
      <div className="absolute left-0 top-7 z-30 w-[194px] rounded-[9px] border border-[#dfded8] bg-white p-1.5 shadow-[0_14px_40px_rgba(22,22,18,0.14)]">
        {enableWorkflowActions && (agentId === "planner" ? (
          <>
            <button type="button" onClick={onSave} disabled={saved || isPreparingSave || preparingHandoff !== null} className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-control text-[#5e5d56] hover:bg-[#f4f4f1] disabled:opacity-40">
              {isPreparingSave ? "正在准备方案…" : saved ? "已保存为当前方案" : "整理并保存为当前方案"}
            </button>
            <button type="button" onClick={() => onHandoff("coder")} disabled={isPreparingSave || preparingHandoff !== null} className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-control text-[#5e5d56] hover:bg-[#f4f4f1] disabled:opacity-40">
              {preparingHandoff === "coder" ? "正在整理任务…" : "整理任务交给工程师牛牛"}
            </button>
            <button type="button" onClick={() => onHandoff("designer")} disabled={isPreparingSave || preparingHandoff !== null} className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-control text-[#5e5d56] hover:bg-[#f4f4f1] disabled:opacity-40">
              {preparingHandoff === "designer" ? "正在整理任务…" : "整理任务交给艺术家小熊"}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => onReturnHandoff(agentId, "planner", message.body)} className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-control text-[#5e5d56] hover:bg-[#f4f4f1]">
              {agentId === "client" ? "把客户反馈交回小花" : "把结果交回小花"}
            </button>
            {agentId === "designer" && <button type="button" onClick={() => onReturnHandoff("designer", "client", message.body)} className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-control text-[#5e5d56] hover:bg-[#f4f4f1]">交给小雪整理客户材料</button>}
            {agentId === "marketing" && <button type="button" onClick={() => onReturnHandoff("marketing", "designer", message.body)} className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-control text-[#5e5d56] hover:bg-[#f4f4f1]">交给小熊制作配图</button>}
          </>
        ))}
        {enableWorkflowActions && <div className="my-1 border-t border-[#ecebe7]" />}
        <button type="button" onClick={openRecord} disabled={!projectId} className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-control text-[#5e5d56] hover:bg-[#f4f4f1] disabled:opacity-40">
          记录为项目进展
        </button>
        <div className="my-1 border-t border-[#ecebe7]" />
        <FeishuPublishButton agentId={agentId} projectId={projectId} content={message.body} messageId={message.id} menuItem onNotice={onNotice} />
      </div>
    </details>
    {recordOpen && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/25 p-5" role="dialog" aria-modal="true" aria-label="记录为项目进展">
      <div className="w-full max-w-[520px] rounded-[12px] border border-[#d9d8d2] bg-white shadow-2xl">
        <div className="flex items-start border-b border-[#e7e6e1] px-5 py-4"><div className="flex-1"><h3 className="text-section-title font-semibold text-[#31312d]">记录为项目进展</h3><p className="mt-1 text-control text-[#929188]">只记录已经形成的成果或决定，不会复制完整对话。</p></div><button type="button" onClick={() => setRecordOpen(false)} disabled={recording} className="text-page-title text-[#999890]">×</button></div>
        <div className="space-y-4 px-5 py-4">
          <label className="block"><span className="mb-1.5 block text-control font-medium text-[#55554f]">进展分类</span><select value={recordCategory} onChange={(event) => setRecordCategory(event.target.value as ProgressCategory)} className="h-9 w-full rounded-md border border-[#d9d8d2] bg-white px-2.5 text-control outline-none focus:border-[#8ba697]">{progressCategories.map((category) => <option key={category} value={category}>{progressCategoryLabels[category]}</option>)}</select></label>
          <label className="block"><span className="mb-1.5 block text-control font-medium text-[#55554f]">进展摘要</span><textarea value={recordSummary} onChange={(event) => setRecordSummary(event.target.value.slice(0, 240))} rows={4} className="w-full resize-y rounded-md border border-[#d9d8d2] px-3 py-2 text-body leading-5 outline-none focus:border-[#8ba697]" /><span className="mt-1 block text-right text-micro text-[#aaa9a1]">{recordSummary.length}/240</span></label>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e7e6e1] px-5 py-3.5"><button type="button" onClick={() => setRecordOpen(false)} disabled={recording} className="h-8 rounded-md border border-[#d9d8d2] px-3 text-control text-[#66655e]">取消</button><button type="button" onClick={() => void saveProgress()} disabled={recording || recordSummary.trim().length < 3} className="h-8 rounded-md bg-[#243f34] px-3.5 text-control font-medium text-white disabled:opacity-40">{recording ? "正在记录…" : "确认记录"}</button></div>
      </div>
    </div>}
    </>
  );
}

function IntroBlock({ agentId }: { agentId: Exclude<AgentId, "planner"> }) {
  if (agentId === "designer") {
    return (
      <div className="py-3 text-body leading-[1.75] text-[#55554f]">
        <p className="mb-3 text-panel-title font-medium text-[#2d2d29]">我是艺术家小熊。</p>
        <p>我可以根据当前项目策划，帮助生成：</p>
        <ul className="my-3 space-y-1 text-[#696861]">
          <li>· 视觉概念</li>
          <li>· 任务物料</li>
          <li>· 海报与线索卡</li>
          <li>· UI 视觉与图片修改</li>
        </ul>
        <p className="border-l-2 border-[#deddd7] pl-3 text-body text-[#999890]">
          在下方输入区选择“只聊不画”可以讨论方案；切到“生成图片”并点击“开始作画”才会调用图片模型。
        </p>
      </div>
    );
  }

  if (agentId === "client") {
    return (
      <div className="py-3 text-body leading-[1.75] text-[#55554f]">
        <p className="mb-3 text-panel-title font-medium text-[#2d2d29]">我是客户伙伴小雪。</p>
        <p>我把已确认的项目内容整理成适合 B 端客户阅读的材料和沟通草稿，例如提案、会议纪要、进度汇报和修改意见回复。</p>
        <p className="mt-4 border-l-2 border-[#deddd7] pl-3 text-body text-[#999890]">
          我不会重新决定策划、价格、范围或交期。所有输出默认是内部草稿，也不会自动发送给客户。
        </p>
      </div>
    );
  }

  if (agentId === "buyer") {
    return (
      <div className="py-3 text-body leading-[1.75] text-[#55554f]">
        <p className="mb-3 text-panel-title font-medium text-[#2d2d29]">我是金牌买手拉夫。</p>
        <p>告诉我你要采购什么、数量、预算和规格。我会到 1688 找品，比较价格、起订量、供应商资质、销量、履约和定制能力。</p>
        <p className="mt-4 border-l-2 border-[#deddd7] pl-3 text-body text-[#999890]">
          找品结果只有在你明确选择后才会保存。你可以从采购候选中选择最多 10 家商家，核对问题并确认发送；拉夫会整理商家回复，但不会下单或付款。
        </p>
      </div>
    );
  }

  if (agentId === "marketing") {
    return (
      <div className="py-3 text-body leading-[1.75] text-[#55554f]">
        <p className="mb-3 text-panel-title font-medium text-[#2d2d29]">我是宣传委员豆豆。</p>
        <p>我会把当前项目的真实成果整理成适合小红书或微信公众号的营销图文，包括标题、正文、封面文案、配图清单和发布备注。</p>
        <p className="mt-4 border-l-2 border-[#deddd7] pl-3 text-body text-[#999890]">
          右侧用于保存和编辑正式营销草稿。第一版不会直接登录或发布到任何内容平台。
        </p>
      </div>
    );
  }

  return (
    <div className="py-3 text-body leading-[1.75] text-[#55554f]">
      <p className="mb-3 text-panel-title font-medium text-[#2d2d29]">我是工程师牛牛。</p>
      <p>我是你、小花与 Codex 之间的工程工作入口。你可以直接和我讨论技术问题；已绑定仓库时，Codex 还能以只读方式分析项目代码。</p>
      <div className="mt-4 flex items-start gap-2.5 border-l-2 border-[#deddd7] pl-3 text-body leading-5 text-[#999890]">
        <span>你可以直接和我讨论，也可以从当前对话点击“确认并执行”。代码修改完成后会自动保存到本地；需要时可在输入框上方同步远端或合并主干。</span>
      </div>
    </div>
  );
}

export function AgentPanel({
  agentId,
  messages,
  tasks,
  saved,
  onSave,
  onHandoff,
  onClose,
  canClose = true,
  onSendMessage,
  isGenerating,
  error,
  isLoadingHistory,
  projectId,
  onNotice,
  conversationId,
  onConversationChange,
  onReturnHandoff,
  onCodingReply,
  onCodingExecutionState,
  isPreparingSave = false,
  preparingHandoff = null,
  progressMessage,
  startedAt,
  composerValue,
  onComposerValueChange,
}: AgentPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [codingBusy, setCodingBusy] = useState(false);
  const [codingError, setCodingError] = useState<string>();
  const [latestCodingRun, setLatestCodingRun] = useState<CodingRunView | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [designDraft, setDesignDraft] = useState<DesignDraft | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const meta = agentMeta[agentId];

  useEffect(() => {
    if (!isGenerating || !startedAt) return;
    const timer = window.setInterval(() => setTimerNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [isGenerating, startedAt]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, tasks.length, isGenerating, isLoadingHistory, error, designDraft]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const startCodingExecution = async (sourceMessageId: string) => {
    if (!projectId || codingBusy) return;
    const sourceIndex = messages.findIndex((message) => message.id === sourceMessageId);
    const latestUserMessage = messages.slice(0, sourceIndex).reverse().find((message) => message.role === "user");
    if (!latestUserMessage) {
      onNotice("请先在当前对话中说明需要修改什么。");
      return;
    }
    const instruction = latestUserMessage.body.trim();
    const title = instruction.replace(/\s+/g, " ").slice(0, 60) || "根据当前对话修改代码";
    setCodingBusy(true);
    setCodingError(undefined);
    onCodingExecutionState(true);
    onNotice("Codex 已开始修改代码");
    try {
      const createResponse = await fetch("/api/coding-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          sourceMessageId,
          task: {
            title,
            instruction,
            background: "来自用户与工程师牛牛的当前对话。",
            requirements: [],
            constraints: [],
            unchangedScope: ["不要修改与本次明确指令无关的功能"],
            acceptanceCriteria: ["完成用户明确要求的修改并运行相关检查"],
            sourcePlanVersion: null,
          },
        }),
      });
      const createPayload = await createResponse.json().catch(() => null) as { run?: CodingRunView; error?: string } | null;
      if (!createResponse.ok || !createPayload?.run) throw new Error(createPayload?.error || "暂时无法创建工程任务。");
      const response = await fetch(`/api/coding-runs/${createPayload.run.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; message?: { id: string; role: "assistant"; content: string; createdAt: string; durationMs?: number | null } } | null;
      if (!response.ok) throw new Error(payload?.error || "Codex 执行失败。");
      if (payload?.message) onCodingReply({ id: payload.message.id, role: "agent", body: payload.message.content, durationMs: payload.message.durationMs });
      onNotice("Codex 已完成本次修改并保存到本地，请检查代码改动与测试结果");
      window.dispatchEvent(new Event("sugar:coding-runs-changed"));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Codex 执行失败。";
      setCodingError(message);
      onCodingExecutionState(false, message);
      window.dispatchEvent(new Event("sugar:coding-runs-changed"));
    } finally {
      setCodingBusy(false);
      onCodingExecutionState(false);
    }
  };

  return (
    <section className="panel-in flex min-w-0 flex-1 flex-col bg-white" aria-label={meta.name}>
      <header className="flex h-[66px] shrink-0 items-center border-b border-[#ecebe7] px-4">
        <AgentAvatar agentId={agentId} initials={meta.initials} className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[#e1e0da] bg-[#f7f7f4] text-body font-semibold text-[#50504a]" />
        <div className="ml-2.5 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-panel-title font-semibold tracking-[-0.015em] text-[#292925]">{meta.name}</h2>
            {agentId === "coder" && (
              <span className="rounded border border-[#e4e3de] px-1.5 py-0.5 text-micro font-medium uppercase tracking-[0.08em] text-[#999890]">
                Codex 连接器
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-control text-[#999890]">{meta.description}</p>
        </div>
        {canClose && <div ref={menuRef} className="relative ml-auto">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label={`${meta.name}面板选项`}
            aria-expanded={menuOpen}
            className="grid h-8 w-8 place-items-center rounded-md text-[16px] text-[#8e8d85] hover:bg-[#f3f3f0]"
          >
            ···
          </button>
          {menuOpen && (
            <div className="panel-in absolute right-0 top-9 z-30 w-[166px] rounded-[9px] border border-[#dfded8] bg-white p-1.5 shadow-[0_14px_40px_rgba(22,22,18,0.14)]">
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-body text-[#595852] hover:bg-[#f4f4f1]"
              >
                <span className="mr-2.5 text-[#999890]">×</span>
                关闭面板
              </button>
              <div className="my-1 border-t border-[#ecebe7]" />
              <div className="px-2.5 py-1.5 text-control text-[#b3b2aa]">更多功能即将支持</div>
            </div>
          )}
        </div>}
      </header>
      <ConversationBar projectId={projectId} agentId={agentId} conversationId={conversationId} refreshKey={messages.length} onSelect={(id) => onConversationChange(agentId, id)} onNotice={onNotice} />

      <div ref={scrollRef} className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {agentId !== "planner" && tasks.length === 0 && messages.length === 0 && (
          <IntroBlock agentId={agentId} />
        )}

        {isLoadingHistory && (
          <div role="status" className="flex items-center gap-2 py-3 text-body text-[#999890]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#71877c]" aria-hidden="true" />
            正在加载与{meta.name}的对话…
          </div>
        )}

        {agentId !== "coder" && tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}

        {agentId === "client" && (
          <ClientDeliveryPanel
            disabled={isGenerating || isLoadingHistory || !projectId}
            projectId={projectId}
            latestDraft={[...messages].reverse().find((message) => message.role === "agent")?.body}
            onCreateDraft={(message) => onSendMessage("client", message)}
            onNotice={onNotice}
          />
        )}

        {messages.map((message, index) => {
          if (message.role === "task") {
            return (
              <div key={message.id} className="mb-5 overflow-hidden rounded-[9px] border border-[#d9e6df] bg-[#f4f8f6]">
                <div className="border-b border-[#dfeae4] px-3.5 py-2.5 text-control font-medium uppercase tracking-[0.1em] text-[#557267]">
                  来自制作人小花的新任务
                </div>
                <pre className="whitespace-pre-wrap px-3.5 py-3 font-sans text-body leading-[1.7] text-[#5f6d67]">{message.body}</pre>
              </div>
            );
          }
          const isLastPlannerResponse =
            agentId === "planner" &&
            index === messages.length - 1 &&
            message.role === "agent";
          const isLastSpecialistResponse = agentId !== "planner" && index === messages.length - 1 && message.role === "agent";
          const isCodexCompletion = agentId === "coder"
            && message.role === "agent"
            && latestCodingRun?.implementationSummary?.trim() === message.body.trim();
          const displayedBody = isCodexCompletion ? cleanCodexCompletionForDisplay(message.body) : message.body;
          return (
            <div key={message.id} className="mb-5">
              <div className="mb-2 flex items-center gap-2 text-control font-medium text-[#85847c]">
                {message.role === "user" ? (
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#262622] text-caption text-white">你</span>
                ) : (
                  <AgentAvatar agentId={agentId} initials={meta.initials} className="grid h-5 w-5 place-items-center rounded-full bg-[#eeeeea] text-caption text-[#5b5a54]" />
                )}
                {message.role === "user" ? "你" : meta.name}
              </div>
              {message.role === "agent" ? (
                <MarkdownMessage content={displayedBody} className="pl-7 text-chat text-[#454540]" />
              ) : (
                <p className="whitespace-pre-wrap pl-7 text-chat text-[#454540]">{displayedBody}</p>
              )}
              {message.visualSources && message.visualSources.length > 0 && (
                <div className="ml-7 mt-2 flex gap-2 overflow-x-auto">
                  {message.visualSources.map((source) => <div key={`${source.kind}:${source.id}`} className="shrink-0 overflow-hidden rounded-md border border-[#e0dfda] bg-[#f7f7f4]">
                    {source.previewUrl && <img src={source.previewUrl} alt={source.name} className="h-16 w-16 object-cover" />}
                    <p className="max-w-28 truncate px-1.5 py-1 text-micro text-[#77766f]">{source.name}</p>
                  </div>)}
                </div>
              )}
              {message.role === "agent" && typeof message.durationMs === "number" && (
                <p className="mt-1 pl-7 text-caption text-[#aaa9a1]">本次用时 {formatElapsedTime(message.durationMs)}</p>
              )}
              {agentId === "designer" && (
                <button
                  type="button"
                  onClick={() => setDesignDraft({ prompt: message.body, sources: message.visualSources, nonce: Date.now() })}
                  className="ml-7 mt-2 rounded-md border border-[#d9dedb] bg-white px-2.5 py-1.5 text-control font-medium text-[#486457] hover:bg-[#f4f7f5]"
                >
                  去生图
                </button>
              )}
              {message.role === "agent" && <div id={`agent-actions-${message.id}`} className="ml-7 mt-3 space-y-2" />}
              {agentId === "coder" && isLastSpecialistResponse && !isCodexCompletion && (
                <button
                  type="button"
                  disabled={isGenerating || codingBusy || !projectId}
                  onClick={() => void startCodingExecution(message.id)}
                  className="ml-7 mt-2 h-7 rounded-md bg-[#253d33] px-3 text-control font-medium text-white hover:bg-[#1d3129] disabled:opacity-40"
                >
                  {codingBusy ? "Codex 正在修改…" : "确认并执行"}
                </button>
              )}
              {agentId === "coder" && isLastSpecialistResponse && codingError && <p role="alert" className="ml-7 mt-2 text-control text-[#98584b]">{codingError}</p>}
              {message.role === "agent" && <MessageActionsMenu agentId={agentId} message={message} projectId={projectId} saved={saved} isPreparingSave={isPreparingSave} preparingHandoff={preparingHandoff} onSave={onSave} onHandoff={onHandoff} onReturnHandoff={onReturnHandoff} onNotice={onNotice} enableWorkflowActions={isLastPlannerResponse || (isLastSpecialistResponse && !isCodexCompletion)} />}
            </div>
          );
        })}

        {agentId === "coder" && <CodingRunsPanel
          projectId={projectId}
          refreshKey={tasks.length}
          latestAgentMessage={messages.at(-1)?.role === "agent" ? messages.at(-1)?.body : undefined}
          onLatestRunChange={setLatestCodingRun}
        />}

        <FeishuChangeProposals
          projectId={projectId}
          agentId={agentId}
          refreshKey={messages.length}
          messageIds={messages.filter((message) => message.role === "agent").map((message) => message.id)}
          onNotice={onNotice}
        />

        {isGenerating && (
          <div role="status" className="mb-5 flex items-center gap-2 pl-1 text-body text-[#77766f]">
            <span className="inline-flex gap-0.5" aria-hidden="true">
              <span className="h-1 w-1 animate-pulse rounded-full bg-[#71877c]" />
              <span className="h-1 w-1 animate-pulse rounded-full bg-[#71877c] [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-pulse rounded-full bg-[#71877c] [animation-delay:300ms]" />
            </span>
            <span>{progressMessage || (agentId === "coder" ? "Codex 正在只读分析…" : `${meta.name} 正在生成回复…`)}</span>
            {startedAt && <span className="tabular-nums text-[#999890]">· 已用时 {formatElapsedTime(Math.max(0, timerNow - startedAt))}</span>}
          </div>
        )}

        {error && (
          <div role="alert" className="mb-4 rounded-md border border-[#eadfd8] bg-[#fbf5f1] px-3 py-2 text-body leading-5 text-[#895c49]">
            {error}
          </div>
        )}

        {agentId === "designer" && (
          <DesignImagePanel
            projectId={projectId}
            disabled={isGenerating || isLoadingHistory}
            draft={designDraft}
            onDraftConsumed={() => setDesignDraft(null)}
            onSend={(message, attachments) => onSendMessage(agentId, message, attachments)}
            onNotice={onNotice}
            promptValue={composerValue}
            onPromptValueChange={onComposerValueChange}
          />
        )}
      </div>

      {agentId !== "designer" && <>
        {agentId === "coder" && <CoderGitControls
          projectId={projectId}
          disabled={isGenerating || isLoadingHistory || codingBusy}
          onNotice={onNotice}
        />}
        <AgentComposer
          agentId={agentId}
          disabled={isGenerating || isLoadingHistory}
          projectId={projectId}
          controlledValue={composerValue}
          onControlledValueChange={onComposerValueChange}
          onSend={(message, attachments) => onSendMessage(agentId, message, attachments)}
        />
      </>}
    </section>
  );
}
