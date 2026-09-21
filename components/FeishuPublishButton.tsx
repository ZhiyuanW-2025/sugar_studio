"use client";

import { useState } from "react";
import type { ModelAgentType } from "../lib/model-config/catalog";
import type { AgentId } from "./types";
import { MaterialDestinationModal, type MaterialDestination } from "./MaterialDestinationModal";

const agentTypeById: Record<AgentId, ModelAgentType> = {
  planner: "planning",
  coder: "coding",
  designer: "design",
  client: "client",
  buyer: "procurement",
  marketing: "marketing",
};

export function FeishuPublishButton({
  agentId,
  projectId,
  content,
  messageId,
  menuItem = false,
  onNotice,
}: {
  agentId: AgentId;
  projectId: string | null;
  content: string;
  messageId: string;
  menuItem?: boolean;
  onNotice: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"create_document" | "append_content" | "replace_text">("create_document");
  const [title, setTitle] = useState("");
  const [oldText, setOldText] = useState("");
  const [newText, setNewText] = useState(content);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [choosingDestination, setChoosingDestination] = useState(false);

  const submit = async (destination?: MaterialDestination) => {
    if (!projectId || !title.trim() || submitting) return;
    if (action === "create_document" && !destination) {
      setChoosingDestination(true);
      return;
    }
    if (action === "create_document") {
      setChoosingDestination(false);
    }
    setSubmitting(true); setError(undefined);
    try {
      const response = await fetch(action === "create_document" ? "/api/projects/materials/result" : "/api/knowledge/feishu/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "create_document" ? {
          projectId,
          scopeId: destination!.scopeId,
          parentToken: destination!.parentToken,
          title: title.trim(),
          content: newText.trim(),
        } : {
          projectId,
          agentType: agentTypeById[agentId],
          action,
          documentTitle: title.trim(),
          changeSummary: action === "append_content" ? "将当前 Agent 成果追加到已有飞书知识文档" : "按用户指定原文修改飞书知识文档",
          content: action === "replace_text" ? null : newText.trim(),
          oldText: action === "replace_text" ? oldText.trim() : null,
          newText: action === "replace_text" ? newText.trim() : null,
          sourceAssistantMessageId: messageId,
        }),
      });
      const payload = await response.json().catch(() => null) as { proposal?: { id: string }; saved?: boolean; error?: string } | null;
      if (!response.ok || (action === "create_document" ? !payload?.saved : !payload?.proposal)) throw new Error(payload?.error || "暂时无法保存飞书项目材料。");
      setOpen(false);
      setChoosingDestination(false);
      if (action === "create_document") {
        onNotice("Agent 成果已保存到飞书知识库");
        window.dispatchEvent(new Event("sugar:materials-changed"));
      } else {
        onNotice("已在这条回复下生成飞书待确认操作");
        window.dispatchEvent(new Event("sugar:feishu-proposals-changed"));
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : "暂时无法创建飞书知识变更。");
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setNewText(content); setOpen(true); }}
        disabled={!projectId}
        className={menuItem
          ? "flex h-8 w-full items-center rounded-md px-2.5 text-left text-control text-[#5e5d56] hover:bg-[#f4f4f1] disabled:opacity-40"
          : "h-7 rounded-md border border-[#d9e0ea] bg-[#f7f9fd] px-2.5 text-control font-medium text-[#50627d] disabled:opacity-40"}
      >
        保存为项目材料
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-[#171713]/20 px-5" role="dialog" aria-modal="true" aria-label="准备飞书知识变更">
          <div className="w-full max-w-[520px] rounded-[11px] border border-[#dddcd6] bg-white p-5 shadow-[0_24px_80px_rgba(20,20,16,0.18)]">
            <div className="flex items-start">
              <div><h3 className="text-panel-title font-semibold text-[#2f302c]">保存 Agent 成果</h3><p className="mt-1 text-control text-[#96958d]">创建新成果时会在你确认位置后写入飞书知识库。</p></div>
              <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="ml-auto text-[18px] text-[#999890]">×</button>
            </div>
            <label className="mt-4 block text-control text-[#6d6c65]">操作
              <select value={action} onChange={(event) => setAction(event.target.value as typeof action)} disabled={submitting} className="mt-1.5 h-9 w-full rounded-md border border-[#deddd7] bg-white px-2.5 text-body outline-none">
                <option value="create_document">创建新的项目材料</option>
                <option value="append_content">追加到已有文档</option>
                <option value="replace_text">替换已有完整段落</option>
              </select>
            </label>
            <label className="mt-3 block text-control text-[#6d6c65]">{action === "create_document" ? "新文档标题" : "已有文档的完整标题"}
              <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={submitting} maxLength={240} className="mt-1.5 h-9 w-full rounded-md border border-[#deddd7] px-2.5 text-body outline-none" placeholder="例如：活动策划方法论" />
            </label>
            {action === "replace_text" && <label className="mt-3 block text-control text-[#6d6c65]">需要替换的完整原段落<textarea value={oldText} onChange={(event) => setOldText(event.target.value)} disabled={submitting} rows={3} className="mt-1.5 w-full resize-y rounded-md border border-[#deddd7] px-2.5 py-2 text-control leading-5 outline-none" /></label>}
            <label className="mt-3 block text-control text-[#6d6c65]">{action === "replace_text" ? "替换后的段落" : "写入内容"}
              <textarea value={newText} onChange={(event) => setNewText(event.target.value)} disabled={submitting} rows={7} className="mt-1.5 w-full resize-y rounded-md border border-[#deddd7] px-2.5 py-2 text-control leading-5 outline-none" />
            </label>
            {error && <p role="alert" className="mt-2 text-caption text-[#98584b]">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="h-8 rounded-md border border-[#deddd7] px-3 text-control text-[#6d6c65]">取消</button>
              <button type="button" onClick={() => void submit()} disabled={submitting || !title.trim() || !newText.trim() || (action === "replace_text" && !oldText.trim())} aria-busy={submitting} className="h-8 rounded-md bg-[#30342f] px-3 text-control font-medium text-white disabled:opacity-45">{submitting ? "正在保存…" : action === "create_document" ? "选择位置并保存" : "生成待确认变更"}</button>
            </div>
          </div>
        </div>
      )}
      {choosingDestination && projectId && <MaterialDestinationModal
        projectId={projectId}
        fixedTarget="knowledge"
        onCancel={() => setChoosingDestination(false)}
        onConfirm={(destination) => void submit(destination)}
      />}
    </>
  );
}
