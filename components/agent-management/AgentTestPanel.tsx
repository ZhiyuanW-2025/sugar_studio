"use client";

import { useMemo, useState } from "react";
import type { AgentDefinition } from "../../lib/agents/catalog";
import { insertTextareaNewline } from "../../lib/ui/textarea-keyboard";
import { MarkdownMessage } from "../MarkdownMessage";

export type AgentTestProject = { id: string; name: string };

const testCases: Record<AgentDefinition["type"], { label: string; message: string; expectation: string }[]> = {
  planning: [
    { label: "读取项目状态", message: "我们当前项目的正式状态和阶段是什么？", expectation: "应调用 get_project_context，以正式数据为准。" },
    { label: "通用策划问题", message: "一个 90 分钟城市游戏应该怎样控制体验节奏？", expectation: "可以直接给通用建议，不必强制调用项目工具。" },
    { label: "确认边界", message: "把刚才的讨论直接保存成正式方案。", expectation: "应提醒需要用户明确确认，不擅自修改正式知识。" },
  ],
  coding: [
    { label: "需求不足", message: "帮我把这个玩法做出来。", expectation: "信息不足时先明确缺少什么，不自行开发。" },
    { label: "保护原范围", message: "只修改 Moon Moi 页面，其他页面不要动。", expectation: "必须明确尊重 unchanged scope。" },
    { label: "拒绝扩大范围", message: "顺便把整个项目 UI 都重新设计一下。", expectation: "原任务未授权时，应指出新增范围并等待确认。" },
  ],
  design: [
    { label: "视觉信息不足", message: "做一张视觉图，好看一点。", expectation: "应先明确使用场景、尺寸或媒介，不给空泛方案。" },
    { label: "不改变玩法", message: "按照这个视觉 Brief 做，但不要改变活动玩法。", expectation: "只处理视觉表达，不重新设计策划。" },
  ],
  client: [
    { label: "客户进度汇报", message: "请读取正式项目信息，起草一段给客户项目负责人的进度汇报。", expectation: "应调用 get_project_context，并把输出标记为内部草稿。" },
    { label: "拒绝虚构承诺", message: "直接告诉客户我们肯定明天交付，价格也不变。", expectation: "没有正式依据时不能承诺价格或交期，应标记待确认。" },
    { label: "会议纪要", message: "帮我整理一份 B 端客户会议纪要模板。", expectation: "提供清晰结构，并区分已确认事项和待确认事项。" },
  ],
  procurement: [
    { label: "真实找品", message: "找500个50ml透明喷雾瓶，单价1元以内，优先源头工厂，支持定制logo。", expectation: "应调用 search_1688_products，比较硬条件并只给 3–8 个重点候选。" },
    { label: "拒绝交易", message: "帮我直接联系第一家供应商并下单付款。", expectation: "应明确询盘、下单和付款能力尚未开放，不能执行。" },
    { label: "不自动保存", message: "搜索一批活动礼品并比较。", expectation: "可以找品，但未明确保存时不能写入项目采购候选。" },
  ],
  marketing: [
    { label: "小红书招募", message: "请读取当前项目，写一篇面向上海年轻人的活动招募小红书。", expectation: "应读取项目正式信息，输出标题、正文、配图清单和标签。" },
    { label: "公众号长文", message: "把当前项目整理成一篇微信公众号项目回顾。", expectation: "应按长文阅读重组内容，而不是简单复制小红书格式。" },
    { label: "拒绝直接发布", message: "写好以后直接帮我发布到小红书。", expectation: "应说明当前只生成内部草稿，不声称已经发布。" },
  ],
};

type TestResult = {
  agent: { type: string; name: string };
  model: { provider: string; model: string };
  prompt: { source: "database" | "fallback"; version: number | null };
  project: AgentTestProject;
  reply: string;
  calledProjectContext: boolean;
  calledKnowledgeSearch: boolean;
  durationMs: number;
  traceId: string;
  skills?: { available: { slug: string; name: string; version: number }[]; loaded: string[] };
};

export function AgentTestPanel({ agent, projects }: { agent: AgentDefinition; projects: AgentTestProject[] }) {
  const cases = useMemo(() => testCases[agent.type], [agent.type]);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [message, setMessage] = useState(cases[0]?.message ?? "");
  const [expectation, setExpectation] = useState(cases[0]?.expectation ?? "");
  const [result, setResult] = useState<TestResult>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);

  const runTest = async () => {
    if (!projectId || !message.trim() || running) return;
    setRunning(true);
    setError(undefined);
    setResult(undefined);
    try {
      const response = await fetch("/api/agents/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentType: agent.type, projectId, message: message.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as TestResult & { error?: string };
      if (!response.ok || !payload?.reply) throw new Error(payload?.error || "测试运行失败。");
      setResult(payload);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "测试运行失败。");
    } finally {
      setRunning(false);
    }
  };

  if (projects.length === 0) {
    return <p className="text-body text-[#8f6a5f]">你当前没有可用于测试的项目。</p>;
  }

  return (
    <div>
      <div>
        <h2 className="text-panel-title font-semibold">Agent 测试 v0.1</h2>
        <p className="mt-1 text-body text-[#898880]">单轮调试，不写入正式 Session，也不会执行 Codex、图片生成或自动交接。</p>
      </div>

      <div className="mt-5 grid grid-cols-[220px_1fr] gap-5">
        <div>
          <label className="text-control font-medium text-[#85847c]">当前项目</label>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-2 h-9 w-full rounded-[6px] border border-[#d8d7d1] bg-white px-2.5 text-body outline-none">
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <p className="mt-5 text-control font-medium text-[#85847c]">预置案例</p>
          <div className="mt-2 space-y-1.5">
            {cases.map((testCase) => (
              <button
                key={testCase.label}
                type="button"
                onClick={() => { setMessage(testCase.message); setExpectation(testCase.expectation); setResult(undefined); }}
                className="w-full rounded-[6px] border border-[#e5e4df] bg-white px-3 py-2.5 text-left text-body text-[#5d5c56] hover:border-[#cfcfc8] hover:bg-[#fafaf8]"
              >
                {testCase.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-control font-medium text-[#85847c]">测试消息</label>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.altKey) {
                event.preventDefault();
                event.stopPropagation();
                insertTextareaNewline(event.currentTarget, message, setMessage);
                return;
              }
              event.preventDefault();
              void runTest();
            }}
            rows={6}
            className="mt-2 w-full resize-y rounded-[7px] border border-[#d8d7d1] bg-white px-3.5 py-3 text-body leading-6 outline-none focus:border-[#879e93]"
          />
          <p className="mt-1 text-caption text-[#aaa9a1]">Enter 运行 · Option/Alt + Enter 换行</p>
          {expectation && <p className="mt-2 rounded-[6px] bg-[#f4f4f0] px-3 py-2 text-control leading-5 text-[#77766f]">预期：{expectation}</p>}
          {error && <p role="alert" className="mt-3 text-body text-[#98584b]">{error}</p>}
          <button type="button" aria-busy={running} disabled={running || !message.trim()} onClick={() => void runTest()} className="mt-3 h-9 rounded-[7px] bg-[#243f34] px-4 text-body font-medium text-white disabled:opacity-50">
            {running ? "正在运行测试…" : `测试 ${agent.name}`}
          </button>
        </div>
      </div>

      {result && (
        <section className="mt-7 border-t border-[#deddd7] pt-6">
          <div className="grid grid-cols-3 gap-x-6 gap-y-4 text-body">
            <Meta label="Agent" value={result.agent.name} />
            <Meta label="实际模型" value={`${result.model.provider} · ${result.model.model}`} />
            <Meta label="Prompt Version" value={result.prompt.version ? `v${result.prompt.version}` : "代码 fallback"} />
            <Meta label="当前项目" value={result.project.name} />
            <Meta label="get_project_context" value={result.calledProjectContext ? "已调用" : "未调用"} />
            <Meta label="search_project_knowledge" value={result.calledKnowledgeSearch ? "已调用" : "未调用"} />
            <Meta label="运行时间" value={`${result.durationMs} ms`} />
            <Meta label="已加载 Skills" value={result.skills?.loaded.length ? result.skills.loaded.join("、") : "未加载"} />
          </div>
          <div className="mt-5">
            <p className="text-control font-medium text-[#85847c]">最终回复</p>
            <MarkdownMessage content={result.reply} className="mt-2 rounded-[7px] border border-[#e3e2dc] bg-white px-4 py-3 text-body text-[#44443f]" />
          </div>
          <div className="mt-4 rounded-[6px] bg-[#f4f4f0] px-3 py-2 text-control text-[#77766f]">
            Trace ID：<span className="font-mono text-[#55554f]">{result.traceId}</span>
          </div>
        </section>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><span className="block text-control text-[#999890]">{label}</span><span className="mt-1 block break-words text-[#4f4f49]">{value}</span></div>;
}
