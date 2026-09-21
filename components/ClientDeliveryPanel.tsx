"use client";

import { useCallback, useEffect, useState } from "react";
import { clientDeliverableLabels, type ClientDeliverableType } from "../lib/client-deliverables/types";

type Deliverable = {
  id: string;
  deliverableType: ClientDeliverableType;
  title: string;
  audience: string;
  purpose: string;
  status: "draft" | "in_review" | "approved" | "dispatched" | "archived";
  approvedAt: string | null;
  currentVersion: { id: string; version: number; content: string; change_summary: string; created_at: string } | null;
  dispatches: Array<{ id: string; channel: "email" | "wecom"; recipient: string; status: string; sentAt: string | null }>;
};

type Template = { id: string; name: string; deliverableType: ClientDeliverableType; description: string; outline: string };
const types = Object.entries(clientDeliverableLabels) as Array<[ClientDeliverableType, string]>;
const statusLabel = { draft: "草稿", in_review: "待审核", approved: "已批准", dispatched: "已发送", archived: "已归档" };

export function ClientDeliveryPanel({
  disabled,
  projectId,
  latestDraft,
  onCreateDraft,
  onNotice,
}: {
  disabled: boolean;
  projectId: string | null;
  latestDraft?: string;
  onCreateDraft: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [deliverableType, setDeliverableType] = useState<ClientDeliverableType>("proposal");
  const [audience, setAudience] = useState("");
  const [purpose, setPurpose] = useState("");
  const [title, setTitle] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [expanded, setExpanded] = useState<string>();
  const [editing, setEditing] = useState("");
  const [recipient, setRecipient] = useState("");
  const [channel, setChannel] = useState<"email" | "wecom">("email");
  const [busy, setBusy] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [documentsResponse, templatesResponse] = await Promise.all([
        fetch(`/api/client-deliverables?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
        fetch("/api/client-deliverables/templates", { cache: "no-store" }),
      ]);
      const documents = await documentsResponse.json().catch(() => null);
      const templateData = await templatesResponse.json().catch(() => null);
      if (documentsResponse.ok) setDeliverables(documents.deliverables ?? []);
      if (templatesResponse.ok) setTemplates(templateData.templates ?? []);
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => {
    const pending = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(pending);
  }, [load]);

  const createDraft = () => {
    const cleanPurpose = purpose.trim();
    if (!cleanPurpose || disabled) return;
    const template = templates.find((item) => item.deliverableType === deliverableType);
    onCreateDraft([
      "请基于当前项目的正式信息起草一份客户交付内容。",
      `材料类型：${clientDeliverableLabels[deliverableType]}`,
      `目标读者：${audience.trim() || "请根据现有信息判断，并标记需要我补充的客户角色"}`,
      `本次目的与必须包含的内容：\n${cleanPurpose}`,
      template ? `建议结构：\n${template.outline}` : "",
      "要求：所有内容先作为内部草稿；不要虚构项目事实、价格、范围、交期或发送状态。若正式项目信息不足，请明确标记待确认项。",
    ].filter(Boolean).join("\n\n"));
  };

  const saveLatest = async () => {
    if (!projectId || !latestDraft || busy) return;
    setBusy("create");
    try {
      const response = await fetch("/api/client-deliverables", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, deliverableType, title: title.trim() || clientDeliverableLabels[deliverableType], audience, purpose, content: latestDraft }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "客户材料保存失败");
      onNotice("已保存为可审批的客户材料");
      setTitle("");
      await load();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "客户材料保存失败");
    } finally {
      setBusy(undefined);
    }
  };

  const openDocument = (document: Deliverable) => {
    setExpanded(expanded === document.id ? undefined : document.id);
    setEditing(document.currentVersion?.content ?? "");
  };

  const saveVersion = async (document: Deliverable) => {
    if (!projectId || !editing.trim() || busy) return;
    setBusy(`${document.id}:version`);
    try {
      const response = await fetch(`/api/client-deliverables/${document.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, content: editing, changeSummary: "人工编辑客户材料" }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "版本保存失败");
      onNotice("已保存新版本；原批准状态已撤销");
      await load();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "版本保存失败");
    } finally {
      setBusy(undefined);
    }
  };

  const approve = async (document: Deliverable) => {
    if (!projectId || busy || !window.confirm("确认批准当前版本？批准后才能对外发送；后续编辑会自动撤销批准。")) return;
    setBusy(`${document.id}:approve`);
    try {
      const response = await fetch(`/api/client-deliverables/${document.id}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "批准失败");
      onNotice("当前版本已批准");
      await load();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "批准失败");
    } finally {
      setBusy(undefined);
    }
  };

  const dispatch = async (document: Deliverable) => {
    if (!projectId || !recipient.trim() || busy || !window.confirm(`确认通过${channel === "email" ? "邮件" : "企业微信"}对外发送已批准版本？`)) return;
    setBusy(`${document.id}:dispatch`);
    try {
      const response = await fetch(`/api/client-deliverables/${document.id}/dispatch`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, channel, recipient }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "发送失败");
      onNotice("客户材料已发送并记录");
      setRecipient("");
      await load();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "发送失败");
    } finally {
      setBusy(undefined);
    }
  };

  const download = async (document: Deliverable, format: "docx" | "pdf" | "pptx") => {
    if (!projectId || busy) return;
    setBusy(`${document.id}:export:${format}`);
    try {
      const response = await fetch(`/api/client-deliverables/${document.id}/export/${format}?projectId=${encodeURIComponent(projectId)}`);
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || `${format.toUpperCase()} 导出失败`);
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition") || "";
      const encodedName = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const fileName = encodedName ? decodeURIComponent(encodedName) : `${document.title}.${format}`;
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url; anchor.download = fileName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      onNotice(`${format.toUpperCase()} 已生成并开始下载`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "材料导出失败");
    } finally { setBusy(undefined); }
  };

  return (
    <section className="mb-5 space-y-2.5">
      <div className="rounded-[9px] border border-[#dfe4e1] bg-[#f7f9f7] p-3.5">
        <div className="flex items-start gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] bg-[#e7ece8] text-control font-semibold text-[#466052]">稿</span>
          <div><h3 className="text-body font-semibold text-[#3f4e46]">创建正式客户材料</h3><p className="mt-0.5 text-caption leading-4 text-[#8a938d]">小雪先起草；保存、批准、导出和发送是彼此独立的人工步骤。</p></div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block"><span className="mb-1 block text-caption font-medium text-[#7d857f]">材料类型</span><select value={deliverableType} disabled={disabled} onChange={(event) => setDeliverableType(event.target.value as ClientDeliverableType)} className="h-8 w-full rounded-[6px] border border-[#d8ddd9] bg-white px-2 text-control text-[#4d554f] outline-none">{types.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-caption font-medium text-[#7d857f]">目标读者</span><input value={audience} disabled={disabled} onChange={(event) => setAudience(event.target.value)} placeholder="如：客户项目负责人" className="h-8 w-full rounded-[6px] border border-[#d8ddd9] bg-white px-2 text-control text-[#4d554f] outline-none" /></label>
        </div>
        <label className="mt-2 block"><span className="mb-1 block text-caption font-medium text-[#7d857f]">目的与必须包含的内容</span><textarea value={purpose} disabled={disabled} onChange={(event) => setPurpose(event.target.value)} rows={3} placeholder="例如：确认修改方案，说明变化、保持不变的范围和下一步。" className="w-full resize-none rounded-[6px] border border-[#d8ddd9] bg-white px-2.5 py-2 text-control leading-4 text-[#4d554f] outline-none" /></label>
        <div className="mt-2 flex justify-end"><button type="button" aria-busy={disabled} disabled={disabled || !purpose.trim()} onClick={createDraft} className="h-7 rounded-[6px] bg-[#314a3f] px-2.5 text-caption font-medium text-white disabled:opacity-35">{disabled ? "小雪起草中…" : "交给小雪起草"}</button></div>
        {latestDraft && <div className="mt-3 border-t border-[#dfe4e1] pt-3"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`${clientDeliverableLabels[deliverableType]}标题（可选）`} className="h-8 w-full rounded-[6px] border border-[#d8ddd9] bg-white px-2 text-control outline-none" /><button type="button" aria-busy={busy === "create"} onClick={saveLatest} disabled={!!busy} className="mt-2 h-7 rounded-[6px] border border-[#cbd8d0] bg-white px-2.5 text-caption font-medium text-[#416253] disabled:opacity-40">{busy === "create" ? "保存中…" : "保存小雪最新回复为客户材料"}</button></div>}
      </div>

      {loading && <p role="status" className="px-1 py-3 text-caption text-[#999890]"><span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#557267]" />正在加载客户材料…</p>}
      {!loading && deliverables.length > 0 && <div className="rounded-[9px] border border-[#e2e3df] bg-white p-2.5"><div className="mb-2 px-1 text-caption font-semibold uppercase tracking-[0.08em] text-[#92928a]">客户材料库</div>{deliverables.map((item) => <div key={item.id} className="border-t border-[#eeeeea] py-2 first:border-t-0"><button type="button" onClick={() => openDocument(item)} className="flex w-full items-center gap-2 px-1 text-left"><span className="min-w-0 flex-1 truncate text-control font-medium text-[#42443f]">{item.title}</span><span className={`rounded px-1.5 py-0.5 text-micro ${item.status === "approved" || item.status === "dispatched" ? "bg-[#edf5ef] text-[#48705a]" : "bg-[#f2f2ef] text-[#85857d]"}`}>{statusLabel[item.status]}</span><span className="text-caption text-[#aaa9a2]">v{item.currentVersion?.version ?? 0}</span></button>{expanded === item.id && <div className="mt-2 space-y-2 px-1"><textarea value={editing} onChange={(event) => setEditing(event.target.value)} rows={8} className="w-full resize-y rounded-[6px] border border-[#deded8] p-2 text-control leading-4 outline-none" /><div className="flex flex-wrap gap-1.5"><button aria-busy={busy === `${item.id}:version`} onClick={() => void saveVersion(item)} disabled={!!busy || editing === item.currentVersion?.content} className="h-7 rounded border border-[#d8d8d2] px-2 text-caption disabled:opacity-35">{busy === `${item.id}:version` ? "保存中…" : "保存新版本"}</button><button aria-busy={busy === `${item.id}:approve`} onClick={() => void approve(item)} disabled={!!busy || item.status === "approved" || item.status === "dispatched"} className="h-7 rounded bg-[#304a3e] px-2 text-caption text-white disabled:opacity-35">{busy === `${item.id}:approve` ? "批准中…" : "批准当前版本"}</button>{(["docx", "pdf", "pptx"] as const).map((format) => <button type="button" aria-busy={busy === `${item.id}:export:${format}`} disabled={!!busy} onClick={() => void download(item, format)} key={format} className="grid h-7 place-items-center rounded border border-[#d8d8d2] px-2 text-caption uppercase disabled:opacity-35">{busy === `${item.id}:export:${format}` ? "生成中…" : format}</button>)}</div><div className="flex gap-1.5 border-t border-[#eeeeea] pt-2"><select value={channel} onChange={(event) => setChannel(event.target.value as "email" | "wecom")} className="h-7 rounded border border-[#deded8] px-1.5 text-caption"><option value="email">邮件</option><option value="wecom">企业微信</option></select><input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder={channel === "email" ? "客户邮箱" : "接收对象说明"} className="h-7 min-w-0 flex-1 rounded border border-[#deded8] px-2 text-caption" /><button aria-busy={busy === `${item.id}:dispatch`} onClick={() => void dispatch(item)} disabled={!!busy || !recipient.trim() || item.status !== "approved"} className="h-7 rounded border border-[#d7cdbd] bg-[#fbf7ef] px-2 text-caption text-[#765f3f] disabled:opacity-35">{busy === `${item.id}:dispatch` ? "发送中…" : "确认发送"}</button></div>{item.status !== "approved" && <p className="text-micro text-[#aaa9a2]">发送前必须明确批准；编辑新版本会撤销原批准。</p>}</div>}</div>)}</div>}
    </section>
  );
}
