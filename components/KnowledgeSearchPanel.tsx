"use client";

import { FormEvent, useState } from "react";

type Result = {
  chunkId: string;
  documentId: string;
  scope: "project" | "company";
  fileId: string;
  fileName: string;
  content: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  score: number;
  sourceProvider?: "upload" | "feishu" | "feishu_drive";
  sourceUrl?: string | null;
};

export function KnowledgeSearchPanel({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "project" | "company">("all");
  const [results, setResults] = useState<Result[]>([]);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"helpful" | "not_helpful" | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState<"helpful" | "not_helpful" | null>(null);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true); setError(null); setFeedback(null);
    try {
      const response = await fetch("/api/knowledge/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, query: query.trim(), scope }),
      });
      const payload = await response.json().catch(() => null) as { searchId?: string | null; results?: Result[]; error?: string } | null;
      if (!response.ok || !payload?.results) throw new Error(payload?.error || "知识检索失败。");
      setResults(payload.results); setSearchId(payload.searchId || null);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "知识检索失败。");
    } finally { setLoading(false); }
  };

  const sendFeedback = async (value: "helpful" | "not_helpful") => {
    if (!searchId || feedbackLoading) return;
    setFeedbackLoading(value);
    try {
      const response = await fetch("/api/knowledge/search", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ searchId, feedback: value }) });
      if (response.ok) setFeedback(value);
    } finally { setFeedbackLoading(null); }
  };

  const fileUrl = (result: Result) => result.sourceProvider === "feishu_drive" && result.sourceUrl
    ? result.sourceUrl
    : result.scope === "project"
    ? `/api/projects/files/${result.fileId}?projectId=${projectId}${result.pageNumber ? `#page=${result.pageNumber}` : ""}`
    : `/api/knowledge/company-files/${result.fileId}${result.pageNumber ? `#page=${result.pageNumber}` : ""}`;

  return <div>
    <form onSubmit={search}>
      <textarea value={query} onChange={(event) => setQuery(event.target.value)} rows={3} maxLength={1000} placeholder="例如：Hilton Brief 对体验时长有什么要求？" className="w-full resize-none rounded-[7px] border border-[#d8d7d1] px-3 py-2.5 text-body leading-5 outline-none focus:border-[#9aa9a1]" />
      <div className="mt-2 flex items-center gap-2">
        <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} className="h-8 rounded-md border border-[#deddd7] bg-white px-2 text-caption"><option value="all">项目 + 公司</option><option value="project">仅项目材料</option><option value="company">仅公司知识</option></select>
        <button type="submit" aria-busy={loading} disabled={loading || !query.trim()} className="ml-auto h-8 rounded-md bg-[#243f34] px-3 text-control font-medium text-white disabled:opacity-40">{loading ? "检索中…" : "搜索知识"}</button>
      </div>
    </form>
    {error && <p role="alert" className="mt-4 rounded-md bg-[#fbf3ef] px-3 py-2 text-control text-[#895c49]">{error}</p>}
    {!loading && results.length === 0 && searchId && <p className="mt-6 text-control text-[#999890]">没有找到相关内容。可以换一个更具体的关键词。</p>}
    {results.length > 0 && <div className="mt-5 space-y-3">
      <div className="flex items-center"><p className="text-caption font-medium uppercase tracking-[0.1em] text-[#999890]">最相关的 {results.length} 个片段</p><div className="ml-auto flex gap-1">{feedback ? <span className="text-caption text-[#668072]">感谢反馈</span> : <><button aria-busy={feedbackLoading === "helpful"} disabled={Boolean(feedbackLoading)} onClick={() => void sendFeedback("helpful")} className="text-caption text-[#77766f] disabled:opacity-40">{feedbackLoading === "helpful" ? "提交中…" : "有帮助"}</button><span className="text-[#ccc]">·</span><button aria-busy={feedbackLoading === "not_helpful"} disabled={Boolean(feedbackLoading)} onClick={() => void sendFeedback("not_helpful")} className="text-caption text-[#77766f] disabled:opacity-40">{feedbackLoading === "not_helpful" ? "提交中…" : "没帮助"}</button></>}</div></div>
      {results.map((result) => <article key={result.chunkId} className="rounded-[8px] border border-[#e2e1dc] bg-[#fafaf8] p-3">
        <div className="flex items-center gap-2"><span className={`rounded px-1.5 py-0.5 text-micro ${result.scope === "project" ? "bg-[#e6efe9] text-[#426452]" : "bg-[#ecebf1] text-[#64617a]"}`}>{result.scope === "project" ? "项目" : "公司"}</span><a href={fileUrl(result)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-control font-medium text-[#44443f] hover:underline">{result.fileName}{result.pageNumber ? ` · 第 ${result.pageNumber} 页` : ""}</a><span className="text-micro text-[#aaa9a1]">{Math.round(result.score * 100)}%</span></div>
        <p className="mt-2 whitespace-pre-wrap text-caption leading-[1.65] text-[#66665f]">{result.content}</p>
      </article>)}
    </div>}
  </div>;
}
