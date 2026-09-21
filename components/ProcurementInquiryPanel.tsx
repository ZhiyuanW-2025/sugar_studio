import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SearchResult = {
  id: string; rank: number; item_id: string | null; title: string; image_url: string | null;
  unit_price: number | null; total_price: number | null; min_order_qty: number | null; sales_count: number | null;
  supplier_name: string | null; supplier_years: number | null; supplier_city: string | null;
  customization: string | null; requirement_match: string | null; product_url: string | null; candidate_id: string | null;
};
type SearchRun = { id: string; requirement: string; result_count: number; created_at: string; procurement_search_results: SearchResult[] };
type Candidate = {
  id: string; item_id: string; title: string; image_url: string | null; unit_price: number | null;
  min_order_qty: number | null; supplier_name: string | null; supplier_years: number | null;
  supplier_city: string | null; customization: string | null; requirement_match: string | null; product_url: string | null;
};
type Inquiry = {
  id: string; status: string; mode: "single_round" | "multi_round"; requirement: string; questions: string[];
  supplierCount: number; lastError: string | null; lastSyncedAt: string | null; createdAt: string;
  targets: Array<{ id: string; itemId: string; title: string; productUrl: string; supplierName: string | null; status: string; followUpStatus: "active" | "ended"; hasNewReply: boolean; lastMessageAt: string | null; lastCheckedAt: string | null; latestSummary: string | null; shopUrl: string | null; messages: Array<{ id: string; sender: "buyer" | "seller" | "system"; content: string; sentAt: string | null }> }>;
};

type Tab = "results" | "candidates" | "inquiries";
const activeStatuses = new Set(["creating", "sent", "waiting", "partial"]);
const defaultQuestions = "请确认当前含税单价和阶梯价\n请确认最小起订量\n请确认预计发货时间\n是否支持定制以及相关费用";
const AUTO_FOLLOW_UP_INTERVAL_MS = 5 * 60_000;
const formatTime = (value: string | null) => value ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "";

function InquiryTargetConversation({ target, inquiryRequirement, onReference, onSync, onRead, onToggleFollowUp, syncing, updatingFollowUp }: {
  target: Inquiry["targets"][number];
  inquiryRequirement: string;
  onReference: (text: string) => void;
  onSync: () => void;
  onRead: () => void;
  onToggleFollowUp: () => void;
  syncing: boolean;
  updatingFollowUp: boolean;
}) {
  const referenceText = [
    "【引用商家询价记录】",
    `记录 ID：${target.id}`,
    `厂家：${target.supplierName || "未命名商家"}`,
    `商品：${target.title}`,
    `本轮询价目标：${inquiryRequirement}`,
    target.latestSummary ? `当前结果摘要：${target.latestSummary}` : "当前结果摘要：请读取这条询价记录中的完整聊天。",
    "我想基于这家厂商的记录，和你讨论下一轮询价目标。请先读取并分析记录，不要立即联系商家。",
  ].join("\n");
  return <details onToggle={(event) => { if (event.currentTarget.open && target.hasNewReply) onRead(); }} className={`group overflow-hidden rounded-md border bg-[#fbfbf9] ${target.hasNewReply ? "border-[#9fc2ae] ring-1 ring-[#dcebe2]" : "border-[#e4e5e0]"}`}>
    <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2.5 [&::-webkit-details-marker]:hidden">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${target.hasNewReply ? "animate-pulse bg-[#39a66b]" : target.followUpStatus === "ended" ? "bg-[#aaa9a1]" : target.status === "failed" ? "bg-[#bd5b50]" : target.status === "replied" || target.status === "completed" ? "bg-[#4f9a68]" : "bg-[#d6a43c]"}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-medium text-[#55554f]">{target.supplierName || target.title}</span>
        {target.latestSummary && <span className="mt-0.5 block truncate text-micro text-[#929188]">{target.latestSummary}</span>}
      </span>
      <span className={`shrink-0 text-micro ${target.hasNewReply ? "font-medium text-[#2f8055]" : "text-[#929188]"}`}>{target.hasNewReply ? "有新回复" : target.followUpStatus === "ended" ? "已结束跟进" : target.messages.length > 0 ? `${target.messages.length} 条消息 · 持续跟进中` : "持续跟进中"}</span>
      <span className="text-caption text-[#9a9992] transition-transform group-open:rotate-90">›</span>
    </summary>
    <div className="border-t border-[#e9e9e4] bg-white px-2.5 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-micro text-[#999890]">拉夫与商家的沟通记录</span>
        <a href={target.shopUrl || target.productUrl} target="_blank" rel="noreferrer" className="text-micro text-[#456b5d] underline underline-offset-2">去 1688</a>
      </div>
      {target.messages.length === 0 ? <div className="rounded bg-[#f7f7f4] px-2.5 py-3 text-center text-micro text-[#aaa9a1]">暂时还没有聊天消息，可点击下方“获取最新聊天记录”更新。</div> : <div className="space-y-2.5">
        {target.messages.map((message) => message.sender === "system" ? <div key={message.id} className="text-center text-micro leading-4 text-[#aaa9a1]">{message.content}{message.sentAt ? ` · ${formatTime(message.sentAt)}` : ""}</div> : <div key={message.id} className={`flex ${message.sender === "buyer" ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[86%] ${message.sender === "buyer" ? "text-right" : "text-left"}`}>
            <div className="mb-0.5 text-micro text-[#a09f97]">{message.sender === "buyer" ? "拉夫" : target.supplierName || "商家"}{message.sentAt ? ` · ${formatTime(message.sentAt)}` : ""}</div>
            <div className={`inline-block whitespace-pre-wrap rounded-[8px] px-2.5 py-2 text-left text-caption leading-4 ${message.sender === "buyer" ? "bg-[#eaf2ee] text-[#3d5b4e]" : "border border-[#e5e4df] bg-white text-[#5d5c55]"}`}>{message.content}</div>
          </div>
        </div>)}
      </div>}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[#eeeeea] pt-2.5">
        <button type="button" onClick={onSync} disabled={syncing} className="h-6 rounded border border-[#d7d6d0] bg-white px-2 text-micro text-[#66655e] disabled:opacity-50">{syncing ? "获取中…" : "获取最新聊天记录"}</button>
        <button type="button" onClick={() => onReference(referenceText)} className="h-6 rounded border border-[#b9cec3] bg-white px-2 text-micro font-medium text-[#355f50]">去左侧讨论下一步询价</button>
        <button type="button" onClick={onToggleFollowUp} disabled={updatingFollowUp} className="ml-auto h-6 rounded px-2 text-micro text-[#8a6c62] hover:bg-[#f6f1ee] disabled:opacity-50">{updatingFollowUp ? "处理中…" : target.followUpStatus === "active" ? "结束持续跟进" : "恢复持续跟进"}</button>
      </div>
      <p className="mt-2 text-micro text-[#aaa9a1]">{target.followUpStatus === "active" ? "平台会持续获取这家商家的晚到回复；此处不支持用户直接发消息。" : "已停止自动获取这家商家的新回复，历史记录仍会保留。"}</p>
    </div>
  </details>;
}

function ProductFacts({ item }: { item: SearchResult | Candidate }) {
  return <p className="mt-1 line-clamp-2 text-caption leading-4 text-[#96958d]">
    {item.supplier_name || "供应商待确认"}{item.unit_price != null ? ` · ¥${item.unit_price}` : ""}{item.min_order_qty != null ? ` · 起订 ${item.min_order_qty}` : ""}
    {item.supplier_years != null ? ` · ${item.supplier_years} 年` : ""}{item.supplier_city ? ` · ${item.supplier_city}` : ""}
  </p>;
}

export function ProcurementInquiryPanel({ projectId, disabled, onNotice, onReferenceTarget, refreshKey }: {
  projectId: string | null; disabled: boolean; onNotice: (message: string) => void;
  onReferenceTarget: (message: string) => void; refreshKey: number;
}) {
  const [tab, setTab] = useState<Tab>("results");
  const [runs, setRuns] = useState<SearchRun[]>([]);
  const [hasMoreRuns, setHasMoreRuns] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [selectedResults, setSelectedResults] = useState<string[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [requirement, setRequirement] = useState("");
  const [questions, setQuestions] = useState(defaultQuestions);
  const [mode, setMode] = useState<"single_round" | "multi_round">("multi_round");
  const [timeoutMinutes, setTimeoutMinutes] = useState(30);
  const [sending, setSending] = useState(false);
  const [syncingId, setSyncingId] = useState<string>();
  const [updatingTargetId, setUpdatingTargetId] = useState<string>();
  const lastAutoSyncAt = useRef(new Map<string, number>());

  const load = useCallback(async (quiet = false) => {
    if (!projectId) return;
    if (!quiet) setLoading(true);
    try {
      const [runsResponse, candidatesResponse, inquiriesResponse] = await Promise.all([
        fetch(`/api/procurement/search-runs?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
        fetch(`/api/procurement/candidates?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
        fetch(`/api/procurement/inquiries?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
      ]);
      const runsPayload = await runsResponse.json().catch(() => null) as { searchRuns?: SearchRun[]; hasMore?: boolean; error?: string } | null;
      const candidatesPayload = await candidatesResponse.json().catch(() => null) as { candidates?: Candidate[]; error?: string } | null;
      const inquiriesPayload = await inquiriesResponse.json().catch(() => null) as { inquiries?: Inquiry[]; error?: string } | null;
      if (!runsResponse.ok) throw new Error(runsPayload?.error || "无法加载选品档案。");
      if (!candidatesResponse.ok) throw new Error(candidatesPayload?.error || "无法加载采购候选。");
      if (!inquiriesResponse.ok) throw new Error(inquiriesPayload?.error || "无法加载询价记录。");
      setRuns(runsPayload?.searchRuns ?? []);
      setHasMoreRuns(runsPayload?.hasMore === true);
      setCandidates(candidatesPayload?.candidates ?? []);
      setInquiries(inquiriesPayload?.inquiries ?? []);
    } catch (error) {
      if (!quiet) onNotice(error instanceof Error ? error.message : "暂时无法加载采购工作区。");
    } finally { if (!quiet) setLoading(false); }
  }, [onNotice, projectId]);

  const loadMoreRuns = async () => {
    if (!projectId || loading || !hasMoreRuns) return;
    setLoading(true);
    try {
      const page = Math.floor(runs.length / 20) + 1;
      const response = await fetch(`/api/procurement/search-runs?projectId=${encodeURIComponent(projectId)}&page=${page}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { searchRuns?: SearchRun[]; hasMore?: boolean; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "无法加载更早的选品记录。");
      setRuns((current) => [...current, ...(payload?.searchRuns ?? []).filter((run) => !current.some((item) => item.id === run.id))]);
      setHasMoreRuns(payload?.hasMore === true);
    } catch (error) { onNotice(error instanceof Error ? error.message : "无法加载更早的选品记录。"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(refreshKey > 0), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  const syncInquiry = useCallback(async (inquiryId: string, quiet = false) => {
    if (!projectId || syncingId) return;
    if (!quiet) setSyncingId(inquiryId);
    try {
      const response = await fetch(`/api/procurement/inquiries/${inquiryId}/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
      const payload = await response.json().catch(() => null) as { inquiry?: Inquiry; error?: string } | null;
      if (!response.ok || !payload?.inquiry) throw new Error(payload?.error || "暂时无法同步商家回复。");
      setInquiries((current) => current.map((item) => item.id === inquiryId ? payload.inquiry! : item));
      if (!quiet) onNotice("已同步最新商家回复");
    } catch (error) { if (!quiet) onNotice(error instanceof Error ? error.message : "暂时无法同步商家回复。"); }
    finally { if (!quiet) setSyncingId(undefined); }
  }, [onNotice, projectId, syncingId]);

  useEffect(() => {
    const ids = inquiries.filter((item) => activeStatuses.has(item.status) || item.targets.some((target) => target.followUpStatus === "active")).map((item) => item.id);
    if (!ids.length) return;
    const syncDue = () => {
      if (document.visibilityState !== "visible") return;
      for (const id of ids) {
        const previous = lastAutoSyncAt.current.get(id) ?? 0;
        if (Date.now() - previous < AUTO_FOLLOW_UP_INTERVAL_MS - 5_000) continue;
        lastAutoSyncAt.current.set(id, Date.now());
        void syncInquiry(id, true);
      }
    };
    const initial = window.setTimeout(syncDue, 1_500);
    const timer = window.setInterval(syncDue, AUTO_FOLLOW_UP_INTERVAL_MS);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [inquiries, syncInquiry]);

  const updateTargetFollowUp = useCallback(async (targetId: string, action: "end" | "resume" | "mark_read", quiet = false) => {
    if (!projectId || updatingTargetId) return;
    if (!quiet) setUpdatingTargetId(targetId);
    setInquiries((current) => current.map((inquiry) => ({
      ...inquiry,
      targets: inquiry.targets.map((target) => target.id !== targetId ? target : {
        ...target,
        ...(action === "mark_read" ? { hasNewReply: false } : { followUpStatus: action === "end" ? "ended" as const : "active" as const }),
      }),
    })));
    try {
      const response = await fetch(`/api/procurement/inquiry-targets/${targetId}/follow-up`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action }),
      });
      const payload = await response.json().catch(() => null) as { updated?: boolean; error?: string } | null;
      if (!response.ok || !payload?.updated) throw new Error(payload?.error || "暂时无法更新跟进状态。");
      if (!quiet) onNotice(action === "end" ? "已结束这家商家的持续跟进" : "已恢复这家商家的持续跟进");
    } catch (error) {
      await load(true);
      if (!quiet) onNotice(error instanceof Error ? error.message : "暂时无法更新跟进状态。");
    } finally { if (!quiet) setUpdatingTargetId(undefined); }
  }, [load, onNotice, projectId, updatingTargetId]);

  const saveResults = async (ids: string[], confirmation: string) => {
    if (!projectId || !ids.length) return [] as Array<{ id: string }>;
    setSaving(true);
    try {
      const response = await fetch("/api/procurement/candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, searchResultIds: ids, userConfirmation: confirmation }) });
      const payload = await response.json().catch(() => null) as { candidates?: Array<{ id: string }>; saved?: number; error?: string } | null;
      if (!response.ok || !payload?.candidates) throw new Error(payload?.error || "加入候选失败。");
      await load(true);
      setSelectedResults((current) => current.filter((id) => !ids.includes(id)));
      return payload.candidates;
    } finally { setSaving(false); }
  };

  const addToCandidates = async (ids: string[]) => {
    try {
      const saved = await saveResults(ids, `用户在选品档案中确认将 ${ids.length} 个商品加入采购候选`);
      onNotice(`已加入 ${saved.length} 个采购候选`);
      setTab("candidates");
    } catch (error) { onNotice(error instanceof Error ? error.message : "加入候选失败。"); }
  };

  const startFromResults = async (ids: string[], suggestedRequirement: string) => {
    try {
      const saved = await saveResults(ids, `用户选择 ${ids.length} 个商品直接开始询价`);
      setSelectedCandidates(saved.map((item) => item.id).slice(0, 10));
      setRequirement(suggestedRequirement);
      setQuestions(defaultQuestions);
      setModalOpen(true);
    } catch (error) { onNotice(error instanceof Error ? error.message : "暂时无法准备询价。"); }
  };

  const selectedCandidateRows = useMemo(() => selectedCandidates.map((id) => candidates.find((item) => item.id === id)).filter(Boolean) as Candidate[], [candidates, selectedCandidates]);
  const selectedRunRequirement = useMemo(() => runs.find((run) => run.procurement_search_results.some((item) => selectedResults.includes(item.id)))?.requirement || "请针对所选商品确认采购价格、起订量、交期和定制能力。", [runs, selectedResults]);

  const submitInquiry = async () => {
    if (!projectId || sending) return;
    const questionList = questions.split("\n").map((item) => item.replace(/^\s*\d+[.、）)]?\s*/, "").trim()).filter(Boolean);
    if (!requirement.trim() || !questionList.length || !selectedCandidates.length) return onNotice("请补充采购需求、询价问题和目标商家。");
    setSending(true);
    try {
      const response = await fetch("/api/procurement/inquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, requestId: crypto.randomUUID(), candidateIds: selectedCandidates, requirement, questions: questionList, mode, timeoutMinutes, confirmed: true }) });
      const payload = await response.json().catch(() => null) as { created?: boolean; error?: string } | null;
      if (!response.ok || !payload?.created) throw new Error(payload?.error || "询价发送失败。");
      const count = selectedCandidates.length;
      setModalOpen(false); setSelectedCandidates([]); setTab("inquiries");
      await load(true);
      onNotice(`已提交 ${count} 家商家的询价任务`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "询价发送失败。"); }
    finally { setSending(false); }
  };

  const toggleResult = (id: string) => setSelectedResults((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= 10 ? current : [...current, id]);
  const toggleCandidate = (id: string) => setSelectedCandidates((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= 10 ? current : [...current, id]);

  return <aside className="flex h-full min-h-0 min-w-0 flex-col bg-[#fafaf8]" aria-label="拉夫采购工作区">
    <div className="flex h-[66px] shrink-0 items-center justify-between border-b border-[#e4e3de] px-4">
      <div><h3 className="text-body font-semibold text-[#393934]">采购工作区</h3><p className="mt-0.5 text-caption text-[#999890]">选品、候选和商家询价都会保存在当前项目</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="h-7 rounded-md border border-[#d9d8d2] bg-white px-2.5 text-caption text-[#66655e] disabled:opacity-50">{loading ? "刷新中…" : "刷新"}</button>
    </div>
    <div className="flex h-[38px] shrink-0 border-b border-[#e5e4df] bg-white px-2">
      {(["results", "candidates", "inquiries"] as Tab[]).map((value) => <button key={value} type="button" onClick={() => setTab(value)} className={`relative px-3 text-control ${tab === value ? "font-medium text-[#315847]" : "text-[#8f8e86]"}`}>
        {value === "results" ? "选品结果" : value === "candidates" ? `候选清单 ${candidates.length || ""}` : `询价记录 ${inquiries.length || ""}`}
        {tab === value && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[#527a69]" />}
      </button>)}
    </div>

    <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
      {tab === "results" && <>
        {selectedResults.length > 0 && <div className="sticky top-0 z-10 mb-2.5 flex items-center gap-2 rounded-md border border-[#cddbd4] bg-[#f2f7f4] px-2.5 py-2 shadow-sm">
          <span className="mr-auto text-caption text-[#557064]">已选 {selectedResults.length}/10</span>
          <button type="button" disabled={saving || disabled} onClick={() => void addToCandidates(selectedResults)} className="h-6 rounded border border-[#b9ccc2] bg-white px-2 text-micro text-[#456b5d] disabled:opacity-40">加入候选 待会询价</button>
          <button type="button" disabled={saving || disabled} onClick={() => void startFromResults(selectedResults, selectedRunRequirement)} className="h-6 rounded bg-[#2e5545] px-2 text-micro text-white disabled:opacity-40">直接开始询价</button>
        </div>}
        {runs.length === 0 ? <div className="grid min-h-[240px] place-items-center text-center"><div><p className="text-control font-medium text-[#6f6e67]">还没有选品记录</p><p className="mt-1 text-caption text-[#aaa9a1]">在左侧告诉拉夫你想采购什么，结果会自动永久保存到这里。</p></div></div> : <div className="space-y-3">
          {runs.map((run, runIndex) => <details key={run.id} open={runIndex === 0} className="overflow-hidden rounded-md border border-[#e1e0da] bg-white">
            <summary className="cursor-pointer list-none px-3 py-2.5 [&::-webkit-details-marker]:hidden"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-control font-medium text-[#4a4a45]">{run.requirement}</span><span className="text-micro text-[#aaa9a1]">{run.result_count} 件 · {formatTime(run.created_at)}</span></div></summary>
            <div className="space-y-2 border-t border-[#ecebe7] p-2.5">{run.procurement_search_results.map((item) => {
              const usable = Boolean(item.item_id && item.product_url);
              return <div key={item.id} className={`rounded-md border p-2.5 ${selectedResults.includes(item.id) ? "border-[#9db8aa] bg-[#f4f8f6]" : "border-[#e8e7e2] bg-[#fdfdfc]"}`}>
                <div className="flex gap-2.5">
                  <input type="checkbox" checked={selectedResults.includes(item.id)} disabled={!usable} onChange={() => toggleResult(item.id)} className="mt-1 accent-[#365f4f]" />
                  {item.image_url ? <span role="img" aria-label={item.title} className="h-11 w-11 shrink-0 rounded bg-cover bg-center" style={{ backgroundImage: `url(${item.image_url})` }} /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded bg-[#efefeb] text-caption text-[#aaa9a1]">{item.rank}</span>}
                  <div className="min-w-0 flex-1"><div className="flex items-start gap-2"><p className="line-clamp-2 flex-1 text-control font-medium leading-4 text-[#4b4b45]">{item.title}</p>{item.product_url && <a href={item.product_url} target="_blank" rel="noreferrer" className="shrink-0 text-micro text-[#527063] underline underline-offset-2">1688</a>}</div><ProductFacts item={item} />{item.requirement_match && <p className="mt-1 line-clamp-2 text-micro leading-4 text-[#6d7d75]">{item.requirement_match}</p>}</div>
                </div>
                <div className="mt-2 flex justify-end gap-1.5">
                  {item.candidate_id ? <span className="self-center text-micro text-[#658072]">已加入候选</span> : <button type="button" disabled={!usable || saving || disabled} onClick={() => void addToCandidates([item.id])} className="h-6 rounded border border-[#c9d5cf] bg-white px-2 text-micro text-[#456b5d] disabled:opacity-40">加入候选 待会询价</button>}
                  <button type="button" disabled={!usable || saving || disabled} onClick={() => void startFromResults([item.id], run.requirement)} className="h-6 rounded border border-[#94ad9f] bg-[#f3f8f5] px-2 text-micro text-[#315847] disabled:opacity-40">直接开始询价</button>
                </div>
              </div>;
            })}</div>
          </details>)}
          {hasMoreRuns && <button type="button" onClick={() => void loadMoreRuns()} disabled={loading} className="h-8 w-full rounded-md border border-[#deddd7] bg-white text-caption text-[#77766f] disabled:opacity-50">{loading ? "加载中…" : "加载更早的选品记录"}</button>}
        </div>}
      </>}

      {tab === "candidates" && <>
        {candidates.length === 0 ? <div className="grid min-h-[240px] place-items-center text-center"><div><p className="text-control font-medium text-[#6f6e67]">还没有采购候选</p><p className="mt-1 text-caption text-[#aaa9a1]">从选品结果中加入准备进一步考虑的商品。</p></div></div> : <div className="space-y-2">
          {candidates.map((item) => <label key={item.id} className={`flex cursor-pointer gap-2.5 rounded-md border p-2.5 ${selectedCandidates.includes(item.id) ? "border-[#9db8aa] bg-[#f2f7f4]" : "border-[#e5e4df] bg-white"}`}>
            <input type="checkbox" checked={selectedCandidates.includes(item.id)} onChange={() => toggleCandidate(item.id)} className="mt-1 accent-[#365f4f]" />
            {item.image_url ? <span role="img" aria-label={item.title} className="h-10 w-10 shrink-0 rounded bg-cover bg-center" style={{ backgroundImage: `url(${item.image_url})` }} /> : null}
            <span className="min-w-0 flex-1"><span className="block line-clamp-2 text-control font-medium leading-4 text-[#4b4b45]">{item.title}</span><ProductFacts item={item} /></span>
            {item.product_url && <a href={item.product_url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="text-micro text-[#527063] underline underline-offset-2">1688</a>}
          </label>)}
          <div className="sticky bottom-0 flex items-center rounded-md border border-[#d8ddd9] bg-white px-3 py-2 shadow-[0_-4px_14px_rgba(30,30,25,0.05)]"><span className="mr-auto text-caption text-[#77766f]">已选 {selectedCandidates.length}/10 家</span><button type="button" disabled={!selectedCandidates.length || disabled} onClick={() => { setRequirement("请针对所选商品确认采购价格、起订量、交期和定制能力。"); setQuestions(defaultQuestions); setModalOpen(true); }} className="h-7 rounded bg-[#2e5545] px-3 text-caption text-white disabled:opacity-40">开始询价</button></div>
        </div>}
      </>}

      {tab === "inquiries" && <>{inquiries.length === 0 ? <div className="grid min-h-[240px] place-items-center text-center"><div><p className="text-control font-medium text-[#6f6e67]">还没有询价记录</p><p className="mt-1 text-caption text-[#aaa9a1]">选择商品并确认发送后，商家回复会出现在这里。</p></div></div> : <div className="space-y-2.5">{inquiries.map((inquiry) => {
        const followingCount = inquiry.targets.filter((target) => target.followUpStatus === "active").length;
        const hasNewReply = inquiry.targets.some((target) => target.hasNewReply);
        return <details key={inquiry.id} open={activeStatuses.has(inquiry.status) || hasNewReply} className="rounded-md border border-[#e2e1dc] bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden"><span className={`h-2 w-2 rounded-full ${hasNewReply ? "animate-pulse bg-[#39a66b]" : inquiry.status === "failed" || inquiry.status === "creation_unknown" ? "bg-[#bd5b50]" : followingCount > 0 ? "bg-[#5e8e78]" : "bg-[#aaa9a1]"}`} /><span className="min-w-0 flex-1 truncate text-control font-medium text-[#4b4b45]">{inquiry.requirement}</span><span className={`text-micro ${hasNewReply ? "font-medium text-[#2f8055]" : "text-[#8d8c84]"}`}>{hasNewReply ? "有新回复" : followingCount > 0 ? `${followingCount} 家持续跟进中` : `${inquiry.supplierCount} 家 · 已结束跟进`}</span></summary>
        <div className="border-t border-[#ecebe7] px-3 py-3">{inquiry.lastError && <p className="mb-2 text-caption text-[#a05e51]">{inquiry.lastError}</p>}<div className="space-y-2">{inquiry.targets.map((target) => <InquiryTargetConversation key={target.id} target={target} inquiryRequirement={inquiry.requirement} onReference={onReferenceTarget} onSync={() => void syncInquiry(inquiry.id)} onRead={() => void updateTargetFollowUp(target.id, "mark_read", true)} onToggleFollowUp={() => void updateTargetFollowUp(target.id, target.followUpStatus === "active" ? "end" : "resume")} syncing={syncingId === inquiry.id} updatingFollowUp={updatingTargetId === target.id} />)}</div>
          <div className="mt-2.5 flex justify-end"><span className="text-micro text-[#aaa9a1]">最近获取：{formatTime(inquiry.lastSyncedAt || inquiry.createdAt)}</span></div>
        </div>
      </details>})}</div>}</>}
    </div>

    {modalOpen && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/25 p-5" role="dialog" aria-modal="true" aria-label="确认发送商家询价"><div className="max-h-[88vh] w-full max-w-[620px] overflow-y-auto rounded-[12px] border border-[#d9d8d2] bg-white shadow-2xl">
      <div className="flex items-start border-b border-[#e7e6e1] px-5 py-4"><div className="flex-1"><h3 className="text-section-title font-semibold text-[#31312d]">确认发送商家询价</h3><p className="mt-1 text-control text-[#929188]">确认后会真实联系以下 {selectedCandidateRows.length} 家 1688 商家。不会下单或付款。</p></div><button type="button" onClick={() => setModalOpen(false)} disabled={sending} className="text-page-title text-[#999890]">×</button></div>
      <div className="space-y-4 px-5 py-4"><div className="flex flex-wrap gap-1.5">{selectedCandidateRows.map((item) => <span key={item.id} className="max-w-[260px] truncate rounded bg-[#f1f1ed] px-2 py-1 text-caption text-[#66655e]">{item.supplier_name || item.title}</span>)}</div>
        <label className="block"><span className="mb-1.5 block text-control font-medium text-[#55554f]">采购需求</span><textarea value={requirement} onChange={(event) => setRequirement(event.target.value)} rows={3} className="w-full resize-y rounded-md border border-[#d9d8d2] px-3 py-2 text-body leading-5 outline-none focus:border-[#8ba697]" /></label>
        <label className="block"><span className="mb-1.5 block text-control font-medium text-[#55554f]">询价问题（每行一个）</span><textarea value={questions} onChange={(event) => setQuestions(event.target.value)} rows={5} className="w-full resize-y rounded-md border border-[#d9d8d2] px-3 py-2 text-body leading-5 outline-none focus:border-[#8ba697]" /></label>
        <div className="grid grid-cols-2 gap-3"><label><span className="mb-1.5 block text-control font-medium text-[#55554f]">沟通方式</span><select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} className="h-9 w-full rounded-md border border-[#d9d8d2] bg-white px-2 text-control"><option value="multi_round">多轮沟通（推荐）</option><option value="single_round">只问一次</option></select></label><label><span className="mb-1.5 block text-control font-medium text-[#55554f]">本轮等待时长</span><select value={timeoutMinutes} onChange={(event) => setTimeoutMinutes(Number(event.target.value))} className="h-9 w-full rounded-md border border-[#d9d8d2] bg-white px-2 text-control"><option value={15}>15 分钟</option><option value={30}>30 分钟</option><option value={60}>60 分钟</option><option value={120}>120 分钟</option></select></label></div>
        <p className="rounded-md bg-[#f4f7f5] px-3 py-2 text-caption leading-4 text-[#6f7d76]">本轮到时后，平台仍会持续获取这些商家的晚到回复，直到你手动结束跟进。</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-[#e7e6e1] px-5 py-3.5"><button type="button" onClick={() => setModalOpen(false)} disabled={sending} className="h-8 rounded-md border border-[#d9d8d2] px-3 text-control text-[#66655e]">取消</button><button type="button" onClick={() => void submitInquiry()} disabled={sending || !requirement.trim()} className="h-8 rounded-md bg-[#243f34] px-3.5 text-control font-medium text-white disabled:opacity-40">{sending ? "正在联系商家…" : `确认发送给 ${selectedCandidateRows.length} 家`}</button></div>
    </div></div>}
  </aside>;
}
