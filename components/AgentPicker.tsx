import { useEffect } from "react";
import { agentMeta } from "./mockData";
import type { AgentId } from "./types";
import { AgentAvatar } from "./AgentAvatar";

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
            <h2 id="agent-picker-title" className="text-panel-title font-semibold tracking-[-0.02em] text-[#292925]">添加 Agent</h2>
            <p className="mt-1 text-body text-[#96958e]">将专业 Agent 加入当前工作台</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="ml-auto grid h-7 w-7 place-items-center rounded-md text-[17px] text-[#8c8b83] hover:bg-[#f3f3f0]">×</button>
        </div>
        <div className="mt-1 space-y-1">
          {(["planner", "coder", "designer", "client", "marketing", "buyer"] as AgentId[]).map((agentId) => {
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
                <AgentAvatar agentId={agentId} initials={agent.initials} className="grid h-9 w-9 place-items-center rounded-[9px] border border-[#dfded8] bg-[#f7f7f4] text-body font-semibold text-[#55554f]" />
                <span className="min-w-0 flex-1">
                  <span className={`block text-body font-medium ${added ? "text-[#aaa9a1]" : "text-[#34342f]"}`}>{agent.name}</span>
                  <span className="mt-0.5 block truncate text-control text-[#9a9991]">{agent.description}</span>
                </span>
                <span className={`text-control font-medium ${added ? "text-[#aaa9a1]" : "text-[#4f7566] opacity-0 group-hover:opacity-100"}`}>
                  {added ? "已在工作台" : "添加 +"}
                </span>
              </button>
            );
          })}
          <div className="my-1 border-t border-[#ecebe7]" />
        </div>
      </div>
    </div>
  );
}
