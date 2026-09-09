import { useEffect } from "react";
import { agentMeta } from "./mockData";
import type { AgentId } from "./types";

type AgentPickerProps = {
  openAgents: AgentId[];
  onAdd: (agentId: AgentId) => void;
  onClose: () => void;
};

export function AgentPicker({ openAgents, onAdd, onClose }: AgentPickerProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#161613]/20 px-6 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="agent-picker-title" className="panel-in w-full max-w-[420px] rounded-[12px] border border-[#deddd7] bg-white p-2 shadow-[0_24px_80px_rgba(20,20,16,0.2)]">
        <div className="flex items-center px-3 pb-2 pt-2">
          <div>
            <h2 id="agent-picker-title" className="text-[14px] font-semibold tracking-[-0.02em] text-[#292925]">添加 Agent</h2>
            <p className="mt-1 text-[11px] text-[#96958e]">将专业 Agent 加入当前工作台</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="ml-auto grid h-7 w-7 place-items-center rounded-md text-[17px] text-[#8c8b83] hover:bg-[#f3f3f0]">×</button>
        </div>
        <div className="mt-1 space-y-1">
          {(["planner", "coder", "designer"] as AgentId[]).map((agentId) => {
            const agent = agentMeta[agentId];
            const added = openAgents.includes(agentId);
            return (
              <button
                key={agentId}
                type="button"
                disabled={added}
                onClick={() => onAdd(agentId)}
                className="group flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left hover:bg-[#f6f6f3] disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span className="grid h-9 w-9 place-items-center rounded-[9px] border border-[#dfded8] bg-[#f7f7f4] text-[11px] font-semibold text-[#55554f]">
                  {agent.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13px] font-medium ${added ? "text-[#aaa9a1]" : "text-[#34342f]"}`}>{agent.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-[#9a9991]">{agent.description}</span>
                </span>
                <span className={`text-[10px] font-medium ${added ? "text-[#aaa9a1]" : "text-[#4f7566] opacity-0 group-hover:opacity-100"}`}>
                  {added ? "已在工作台" : "添加 +"}
                </span>
              </button>
            );
          })}
          <div className="my-1 border-t border-[#ecebe7]" />
          {["材料 Agent", "客服 Agent"].map((name, index) => (
            <div key={name} className="flex items-center gap-3 rounded-[8px] px-3 py-2.5 opacity-55">
              <span className="grid h-9 w-9 place-items-center rounded-[9px] border border-[#e3e2dd] bg-[#fafaf8] text-[11px] font-semibold text-[#999890]">
                {index === 0 ? "材" : "客"}
              </span>
              <span className="text-[13px] text-[#77766f]">{name}</span>
              <span className="ml-auto text-[9px] uppercase tracking-[0.08em] text-[#aaa9a1]">即将支持</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
