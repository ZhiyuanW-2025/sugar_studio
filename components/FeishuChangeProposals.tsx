"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ModelAgentType } from "../lib/model-config/catalog";
import type { AgentId } from "./types";

const agentTypeById: Record<AgentId, ModelAgentType> = {
  planner: "planning",
  coder: "coding",
  designer: "design",
  client: "client",
  buyer: "procurement",
  marketing: "marketing",
};

type Proposal = {
  id: string;
  action: "create_document" | "append_content" | "replace_text" | "upload_file";
  document_title: string;
  change_summary: string;
  content: string | null;
  old_text: string | null;
  new_text: string | null;
  status: "pending" | "applying" | "applied" | "cancelled" | "failed" | "conflict";
  result_url: string | null;
  error_message: string | null;
  created_at: string;
  source_knowledge_document_id: string | null;
  source_assistant_message_id: string | null;
  source_file_name: string | null;
  conflict: {
    id: string;
    base_revision: string;
    live_revision: string;
    base_blocks: Array<{ blockId: string; text: string }>;
    live_blocks: Array<{ blockId: string; text: string }>;
    proposed_change: { blockId?: string; oldText?: string; newText?: string };
    conflicting_block_ids: string[];
  } | null;
};

const actionLabel = {
  create_document: "创建飞书文档",
  append_content: "追加飞书内容",
  replace_text: "修改飞书段落",
  upload_file: "上传原文件到飞书",
} as const;

export function FeishuChangeProposals({
  projectId,
  agentId,
  refreshKey,
  messageIds,
  onNotice,
}: {
  projectId: string | null;
  agentId: AgentId;
  refreshKey: number;
  messageIds: string[];
  onNotice: (message: string) => void;
}) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const [customByConflict, setCustomByConflict] = useState<Record<string, string>>({});
  const [, setPortalVersion] = useState(0);
  const messageKey = messageIds.join(",");

  const load = useCallback(async () => {
    if (!projectId) return;
    const query = new URLSearchParams({ projectId, agentType: agentTypeById[agentId] });
    const response = await fetch(`/api/knowledge/feishu/proposals?${query}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { proposals?: Proposal[]; error?: string } | null;
    if (!response.ok || !payload?.proposals) throw new Error(payload?.error || "暂时无法加载飞书知识变更。");
    setProposals(payload.proposals.filter((item) => item.status !== "cancelled"));
  }, [agentId, projectId]);

  useEffect(() => {
    let cancelled = false;
    const loadProposals = async () => {
      try {
        await load();
      } catch {
        if (!cancelled) return;
      }
    };
    void loadProposals();
    return () => { cancelled = true; };
  }, [load, refreshKey]);

  useEffect(() => {
    const refresh = () => void load().catch(() => undefined);
    window.addEventListener("sugar:feishu-proposals-changed", refresh);
    return () => window.removeEventListener("sugar:feishu-proposals-changed", refresh);
  }, [load]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setPortalVersion((value) => value + 1));
    return () => window.cancelAnimationFrame(frame);
  }, [messageKey]);

  const apply = async (proposal: Proposal) => {
    if (busyId) return;
    setBusyId(proposal.id); setError(undefined);
    try {
      const response = await fetch(`/api/knowledge/feishu/proposals/${proposal.id}/apply`, { method: "POST" });
      const payload = await response.json().catch(() => null) as { applied?: boolean; synced?: { documentId?: string | null }; error?: string } | null;
      if (!response.ok || !payload?.applied) throw new Error(payload?.error || "飞书知识写入失败。");
      if (payload.synced?.documentId) {
        await fetch(`/api/knowledge/documents/${payload.synced.documentId}/index`, { method: "POST" }).catch(() => null);
      }
      onNotice("内容已写入飞书，知识索引正在更新");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "飞书知识写入失败。");
      await load().catch(() => undefined);
    } finally { setBusyId(undefined); }
  };

  const cancel = async (proposal: Proposal) => {
    if (busyId) return;
    setBusyId(proposal.id); setError(undefined);
    try {
      const response = await fetch(`/api/knowledge/feishu/proposals/${proposal.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { cancelled?: boolean; error?: string } | null;
      if (!response.ok || !payload?.cancelled) throw new Error(payload?.error || "暂时无法取消变更。");
      setProposals((current) => current.filter((item) => item.id !== proposal.id));
      onNotice("已取消飞书知识变更");
    } catch (value) {
      setError(value instanceof Error ? value.message : "暂时无法取消变更。");
    } finally { setBusyId(undefined); }
  };

  const resolveConflict = async (proposal: Proposal, resolution: "agent" | "feishu" | "custom") => {
    if (busyId || !proposal.conflict) return;
    const customContent = customByConflict[proposal.conflict.id]?.trim();
    if (resolution === "custom" && !customContent) {
      setError("请先填写人工合并后的最终段落。");
      return;
    }
    setBusyId(proposal.id); setError(undefined);
    try {
      const response = await fetch(`/api/knowledge/feishu/conflicts/${proposal.conflict.id}/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution, customContent: resolution === "custom" ? customContent : null }),
      });
      const payload = await response.json().catch(() => null) as { resolved?: boolean; synced?: { documentId?: string | null }; error?: string } | null;
      if (!response.ok || !payload?.resolved) throw new Error(payload?.error || "暂时无法处理冲突。");
      if (payload.synced?.documentId) await fetch(`/api/knowledge/documents/${payload.synced.documentId}/index`, { method: "POST" }).catch(() => null);
      onNotice("飞书冲突已处理，Supabase 知识镜像正在更新");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "暂时无法处理冲突。");
      await load().catch(() => undefined);
    } finally { setBusyId(undefined); }
  };

  const messageIdSet = new Set(messageIds);
  const contextualProposals = proposals.filter((proposal) =>
    proposal.source_assistant_message_id && messageIdSet.has(proposal.source_assistant_message_id),
  );
  if (contextualProposals.length === 0 && !error) return null;

  return (
    <>
      {contextualProposals.map((proposal) => {
        const target = document.getElementById(`agent-actions-${proposal.source_assistant_message_id}`);
        if (!target) return null;
        const busy = busyId === proposal.id || proposal.status === "applying";
        const conflict = proposal.conflict;
        const conflictBlockId = conflict?.proposed_change.blockId;
        const feishuText = conflict?.live_blocks.find((block) => block.blockId === conflictBlockId)?.text ?? "该段落已被删除";
        return createPortal(
          <article key={proposal.id} className="overflow-hidden rounded-[9px] border border-[#d7e2dd] bg-[#f6faf8]">
            <div className="flex items-center border-b border-[#e0e9e4] px-3 py-2 text-caption font-medium text-[#557267]">
              <span className="mr-2 grid h-5 w-5 place-items-center rounded bg-[#3370ff] text-micro font-semibold text-white">飞</span>
              {actionLabel[proposal.action]} · {proposal.status === "applied" ? "已完成" : proposal.status === "applying" ? "执行中" : proposal.status === "failed" ? "执行失败" : proposal.status === "conflict" ? "需要处理冲突" : "待你确认"}
            </div>
            <div className="px-3 py-3">
              <p className="text-body font-semibold text-[#35453e]">{proposal.document_title}</p>
              <p className="mt-1 text-caption leading-4 text-[#748079]">{proposal.change_summary}</p>
              {proposal.status === "applied" ? (
                <div className="mt-2 flex items-center gap-2 text-caption text-[#557267]">
                  <span>✓ 已完成本次操作</span>
                  {proposal.result_url && <a href={proposal.result_url} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">打开飞书 ↗</a>}
                </div>
              ) : proposal.action === "upload_file" ? (
                <div className="mt-2 rounded-md border border-[#dbe4df] bg-white px-2.5 py-2 text-caption text-[#53665c]">
                  <span className="font-medium">将上传原文件：</span>{proposal.source_file_name || "知识文件"}
                  <p className="mt-1 text-micro text-[#929790]">不会把 Agent 回复当作正文；飞书中将保留原文件格式。</p>
                </div>
              ) : proposal.action === "replace_text" ? (
                <div className="mt-2 space-y-1.5 text-caption leading-4">
                  <div className="rounded bg-[#fbf4f1] px-2 py-1.5 text-[#8a6255]"><span className="font-medium">原文：</span>{proposal.old_text}</div>
                  <div className="rounded bg-white px-2 py-1.5 text-[#51675c]"><span className="font-medium">改为：</span>{proposal.new_text}</div>
                </div>
              ) : (
                <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-white px-2 py-1.5 font-sans text-caption leading-4 text-[#5d655f]">{proposal.content}</pre>
              )}
              {proposal.status === "failed" && <p className="mt-2 text-caption text-[#98584b]">{proposal.error_message || "写入失败，请重新发起变更。"}</p>}
              {proposal.status === "conflict" && conflict && (
                <div className="mt-3 rounded-md border border-[#ead8d0] bg-white p-2.5">
                  <p className="text-caption font-semibold text-[#855e50]">同一段落在飞书中也被修改，请人工合并</p>
                  <div className="mt-2 space-y-1.5 text-micro leading-4">
                    <div className="rounded bg-[#f7f7f4] px-2 py-1.5 text-[#77766f]"><span className="font-medium">基础版本：</span>{conflict.proposed_change.oldText}</div>
                    <div className="rounded bg-[#f1f5fb] px-2 py-1.5 text-[#52657e]"><span className="font-medium">Agent 版本：</span>{conflict.proposed_change.newText}</div>
                    <div className="rounded bg-[#fbf4f1] px-2 py-1.5 text-[#855e50]"><span className="font-medium">飞书最新：</span>{feishuText}</div>
                  </div>
                  <textarea value={customByConflict[conflict.id] ?? ""} onChange={(event) => setCustomByConflict((current) => ({ ...current, [conflict.id]: event.target.value }))} disabled={busy} rows={3} placeholder="也可以在这里填写人工合并后的最终段落" className="mt-2 w-full resize-y rounded border border-[#deddd7] px-2 py-1.5 text-micro leading-4 outline-none" />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => void resolveConflict(proposal, "feishu")} disabled={busy} className="h-6 rounded border border-[#deddd7] px-2 text-micro text-[#74675f] disabled:opacity-45">保留飞书版本</button>
                    <button type="button" onClick={() => void resolveConflict(proposal, "agent")} disabled={busy} className="h-6 rounded border border-[#cdd9e8] bg-[#f4f7fb] px-2 text-micro text-[#52657e] disabled:opacity-45">采用 Agent 版本</button>
                    <button type="button" onClick={() => void resolveConflict(proposal, "custom")} disabled={busy || !customByConflict[conflict.id]?.trim()} className="h-6 rounded bg-[#30342f] px-2 text-micro text-white disabled:opacity-45">采用人工合并</button>
                    <button type="button" onClick={() => void cancel(proposal)} disabled={busy} className="h-6 px-1.5 text-micro text-[#999086] disabled:opacity-45">取消变更</button>
                  </div>
                </div>
              )}
              {proposal.status === "conflict" && !conflict && <p className="mt-2 text-caption text-[#98584b]">{proposal.error_message || "检测到版本冲突，请重新发起变更。"}</p>}
              {proposal.status === "pending" && (
                <div className="mt-3 flex gap-1.5">
                  <button type="button" onClick={() => void cancel(proposal)} disabled={busy} className="h-7 rounded-md border border-[#dcddd8] bg-white px-2.5 text-caption text-[#77766f] disabled:opacity-50">取消</button>
                  <button type="button" onClick={() => void apply(proposal)} disabled={busy} aria-busy={busy} className="h-7 rounded-md bg-[#30342f] px-2.5 text-caption font-medium text-white disabled:opacity-50">{busy ? (proposal.action === "upload_file" ? "正在上传原文件…" : "正在写入…") : (proposal.action === "upload_file" ? "确认上传原文件" : "确认写入飞书")}</button>
                </div>
              )}
            </div>
          </article>,
          target,
          proposal.id,
        );
      })}
      {error && messageIds.length > 0 && (() => {
        const target = document.getElementById(`agent-actions-${messageIds[messageIds.length - 1]}`);
        return target ? createPortal(<p role="alert" className="text-caption text-[#98584b]">{error}</p>, target) : null;
      })()}
    </>
  );
}
