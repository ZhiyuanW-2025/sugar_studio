import { useEffect, useRef, useState } from "react";
import { agentMeta, coderReply, designerReply } from "./mockData";
import type { AgentId, AgentTask, ChatMessage } from "./types";

type AgentPanelProps = {
  agentId: AgentId;
  messages: ChatMessage[];
  tasks: AgentTask[];
  saved: boolean;
  onSave: () => void;
  onHandoff: (target: "coder" | "designer") => void;
  onClose: () => void;
  onSendMessage: (agentId: AgentId, message: string) => void;
};

function AgentComposer({
  agentId,
  onSend,
}: {
  agentId: AgentId;
  onSend: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const meta = agentMeta[agentId];

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="mx-4 mb-4 rounded-[10px] border border-[#deddd7] bg-white shadow-[0_1px_2px_rgba(25,25,20,0.04)] focus-within:border-[#aaa9a1] focus-within:shadow-[0_0_0_3px_rgba(20,20,18,0.035)]">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        rows={2}
        aria-label={`给${meta.name}发消息`}
        placeholder={`给${meta.name}发送消息…`}
        className="block h-[58px] w-full resize-none bg-transparent px-3.5 pt-3 text-[12px] leading-5 text-[#34342f] outline-none placeholder:text-[#aaa9a1]"
      />
      <div className="flex h-8 items-center px-2.5 pb-2">
        <span className="text-[10px] text-[#b1b0a8]">Enter 发送 · Shift + Enter 换行</span>
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          aria-label="发送消息"
          className="ml-auto grid h-6 w-6 place-items-center rounded-md bg-[#22221f] text-[12px] text-white transition-opacity disabled:opacity-25"
        >
          ↑
        </button>
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: AgentTask }) {
  const [expanded, setExpanded] = useState(false);
  const from = agentMeta[task.from];
  return (
    <div className="mb-5 overflow-hidden rounded-[9px] border border-[#d9e6df] bg-[#f4f8f6]">
      <div className="border-b border-[#dfeae4] px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.1em] text-[#557267]">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-[#dbe9e2] text-[9px] font-semibold text-[#3b6253]">
            {from.initials}
          </span>
          来自{from.name}的新任务
        </div>
      </div>
      <div className="px-3.5 py-3">
        <p className="text-[13px] font-semibold tracking-[-0.01em] text-[#25352f]">{task.title}</p>
        {expanded && (
          <pre className="mt-3 whitespace-pre-wrap border-t border-[#dfeae4] pt-3 font-sans text-[11px] leading-[1.7] text-[#5f6d67]">
            {task.content}
          </pre>
        )}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2.5 text-[11px] font-medium text-[#3f6b5a] hover:text-[#274d3e]"
        >
          {expanded ? "收起任务" : "查看完整任务"} <span aria-hidden="true">{expanded ? "↑" : "↗"}</span>
        </button>
      </div>
    </div>
  );
}

function IntroBlock({ agentId }: { agentId: "coder" | "designer" }) {
  if (agentId === "designer") {
    return (
      <div className="py-3 text-[12px] leading-[1.75] text-[#55554f]">
        <p className="mb-3 text-[14px] font-medium text-[#2d2d29]">我是美工 Agent。</p>
        <p>我可以根据当前项目策划，帮助生成：</p>
        <ul className="my-3 space-y-1 text-[#696861]">
          <li>· 视觉概念</li>
          <li>· 任务物料</li>
          <li>· 海报与线索卡</li>
          <li>· UI 视觉与图片修改</li>
        </ul>
        <p className="border-l-2 border-[#deddd7] pl-3 text-[11px] text-[#999890]">
          当前 Demo 暂未连接图片生成模型。
        </p>
      </div>
    );
  }

  return (
    <div className="py-3 text-[12px] leading-[1.75] text-[#55554f]">
      <p className="mb-3 text-[14px] font-medium text-[#2d2d29]">我是代码 Agent。</p>
      <p>我可以接收已确认的策划任务，将需求拆解为清晰的代码执行步骤。</p>
      <div className="mt-4 flex items-start gap-2.5 border-l-2 border-[#deddd7] pl-3 text-[11px] leading-5 text-[#999890]">
        <span>等待来自其他 Agent 的任务，或直接在下方开始对话。</span>
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
  onSendMessage,
}: AgentPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const meta = agentMeta[agentId];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, tasks.length]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <section className="panel-in flex min-w-0 flex-1 flex-col bg-white" aria-label={meta.name}>
      <header className="flex h-[66px] shrink-0 items-center border-b border-[#ecebe7] px-4">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[#e1e0da] bg-[#f7f7f4] text-[11px] font-semibold text-[#50504a]">
          {meta.initials}
        </div>
        <div className="ml-2.5 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[13px] font-semibold tracking-[-0.015em] text-[#292925]">{meta.name}</h2>
            {agentId === "coder" && (
              <span className="rounded border border-[#e4e3de] px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.08em] text-[#999890]">
                Codex 未连接
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[10px] text-[#999890]">{meta.description}</p>
        </div>
        <div ref={menuRef} className="relative ml-auto">
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
                className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-[12px] text-[#595852] hover:bg-[#f4f4f1]"
              >
                <span className="mr-2.5 text-[#999890]">×</span>
                关闭面板
              </button>
              <div className="my-1 border-t border-[#ecebe7]" />
              <div className="px-2.5 py-1.5 text-[10px] text-[#b3b2aa]">更多功能即将支持</div>
            </div>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {agentId !== "planner" && tasks.length === 0 && messages.length === 0 && (
          <IntroBlock agentId={agentId} />
        )}

        {tasks.map((task) => (
          <div key={task.id}>
            <TaskCard task={task} />
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-medium text-[#85847c]">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[#eeeeea] text-[9px] text-[#5b5a54]">
                  {meta.initials}
                </span>
                {meta.name}
              </div>
              <p className="whitespace-pre-wrap pl-7 text-[12px] leading-[1.75] text-[#454540]">
                {agentId === "coder" ? coderReply : designerReply}
              </p>
            </div>
          </div>
        ))}

        {messages.map((message, index) => {
          const isLastPlannerResponse =
            agentId === "planner" &&
            index === messages.length - 1 &&
            message.role === "agent";
          return (
            <div key={message.id} className="mb-5">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-medium text-[#85847c]">
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full text-[9px] ${
                    message.role === "user"
                      ? "bg-[#262622] text-white"
                      : "bg-[#eeeeea] text-[#5b5a54]"
                  }`}
                >
                  {message.role === "user" ? "你" : meta.initials}
                </span>
                {message.role === "user" ? "你" : meta.name}
              </div>
              <p className="whitespace-pre-wrap pl-7 text-[12px] leading-[1.8] text-[#454540]">{message.body}</p>

              {isLastPlannerResponse && (
                <div className="ml-7 mt-4 border-t border-[#ecebe7] pt-3">
                  {saved && (
                    <div className="mb-3 flex items-start gap-2 rounded-md bg-[#f0f6f2] px-2.5 py-2 text-[10px] leading-4 text-[#426452]">
                      <span className="mt-px font-semibold">✓</span>
                      <span>
                        已保存为当前方案
                        <span className="block text-[#6f887b]">其他 Agent 现在可以读取这项更新</span>
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={onSave}
                      className="h-7 rounded-md border border-[#ddddd7] px-2.5 text-[10px] font-medium text-[#5e5d56] hover:bg-[#f6f6f3]"
                    >
                      {saved ? "已保存" : "保存为当前方案"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onHandoff("coder")}
                      className="h-7 rounded-md border border-[#d7e1dc] bg-[#f5f8f6] px-2.5 text-[10px] font-medium text-[#416253] hover:bg-[#edf4f0]"
                    >
                      发送给代码 Agent ↗
                    </button>
                    <button
                      type="button"
                      onClick={() => onHandoff("designer")}
                      className="h-7 rounded-md border border-[#ddddd7] px-2.5 text-[10px] font-medium text-[#5e5d56] hover:bg-[#f6f6f3]"
                    >
                      发送给美工 Agent ↗
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AgentComposer agentId={agentId} onSend={(message) => onSendMessage(agentId, message)} />
    </section>
  );
}
