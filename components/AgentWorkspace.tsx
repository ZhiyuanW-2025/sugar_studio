import { AgentPanel } from "./AgentPanel";
import type { AgentId, AgentTask, ChatMessage, Project } from "./types";

type AgentWorkspaceProps = {
  project: Project;
  openAgents: AgentId[];
  messages: Record<AgentId, ChatMessage[]>;
  tasks: Record<"coder" | "designer", AgentTask[]>;
  saved: boolean;
  onSave: () => void;
  onHandoff: (target: "coder" | "designer") => void;
  onCloseAgent: (agentId: AgentId) => void;
  onSendMessage: (agentId: AgentId, message: string) => void;
  onAddAgent: () => void;
};

export function AgentWorkspace({
  project,
  openAgents,
  messages,
  tasks,
  saved,
  onSave,
  onHandoff,
  onCloseAgent,
  onSendMessage,
  onAddAgent,
}: AgentWorkspaceProps) {
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-[#f8f8f5]">
      <div className="flex h-[37px] shrink-0 items-center border-b border-[#e8e7e2] bg-[#fbfbf9] px-5">
        <span className="text-[10px] font-medium text-[#66665f]">策划执行</span>
        <span className="mx-2 text-[10px] text-[#c2c1ba]">/</span>
        <span className="truncate text-[10px] text-[#929189]">{project.focus}</span>
        <div className="ml-auto flex items-center gap-1.5 text-[9px] text-[#a09f97]">
          <span className="text-[#6e8a7d]">◎</span>
          共享当前项目知识
        </div>
      </div>

      {openAgents.length > 0 ? (
        <div className="flex min-h-0 flex-1 divide-x divide-[#e7e6e1] overflow-hidden">
          {openAgents.map((agentId) => (
            <AgentPanel
              key={agentId}
              agentId={agentId}
              messages={messages[agentId]}
              tasks={agentId === "planner" ? [] : tasks[agentId]}
              saved={saved}
              onSave={onSave}
              onHandoff={onHandoff}
              onClose={() => onCloseAgent(agentId)}
              onSendMessage={onSendMessage}
            />
          ))}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center">
          <div className="text-center">
            <div className="mx-auto grid h-10 w-10 place-items-center rounded-[9px] border border-[#deddd7] bg-white text-[18px] text-[#9a9991]">＋</div>
            <p className="mt-4 text-[13px] font-medium text-[#4c4c46]">工作台暂时没有 Agent</p>
            <p className="mt-1.5 text-[11px] text-[#999890]">添加一个专业 Agent 开始工作</p>
            <button type="button" onClick={onAddAgent} className="mt-4 h-8 rounded-md bg-[#252522] px-3.5 text-[11px] font-medium text-white hover:bg-[#11110f]">添加 Agent</button>
          </div>
        </div>
      )}
    </main>
  );
}
