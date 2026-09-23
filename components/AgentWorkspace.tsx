import { AgentPanel } from "./AgentPanel";
import { agentMeta } from "./mockData";
import { ProcurementInquiryPanel } from "./ProcurementInquiryPanel";
import { MarketingContentPanel } from "./MarketingContentPanel";
import { AgentAvatar } from "./AgentAvatar";
import type {
  AgentAttachment,
  AgentId,
  AgentSendResult,
  AgentTask,
  AgentWorkStatus,
  ChatMessage,
  Project,
} from "./types";

type AgentWorkspaceProps = {
  project: Project;
  openAgents: AgentId[];
  activeAgent: AgentId | null;
  completedAgents: Partial<Record<AgentId, boolean>>;
  messages: Record<AgentId, ChatMessage[]>;
  tasks: Record<AgentId, AgentTask[]>;
  saved: boolean;
  onSave: () => void;
  onHandoff: (target: "coder" | "designer") => void;
  onCloseAgent: (agentId: AgentId) => void;
  onActivateAgent: (agentId: AgentId) => void;
  onSendMessage: (agentId: AgentId, message: string, attachments?: AgentAttachment[]) => Promise<AgentSendResult>;
  generatingAgents: Partial<Record<AgentId, boolean>>;
  agentErrors: Partial<Record<AgentId, string>>;
  loadingAgents: Partial<Record<AgentId, boolean>>;
  onAddAgent: () => void;
  projectId: string | null;
  onNotice: (message: string) => void;
  conversationIds: Partial<Record<AgentId, string>>;
  onConversationChange: (agentId: AgentId, conversationId: string) => void;
  onReturnHandoff: (source: AgentId, target: AgentId, content: string) => void;
  onCodingReply: (message: ChatMessage) => void;
  onCodingExecutionState: (working: boolean, error?: string) => void;
  isPreparingSave: boolean;
  preparingHandoff: "coder" | "designer" | null;
  agentProgress: Partial<Record<AgentId, string>>;
  agentStartedAt: Partial<Record<AgentId, number>>;
  composerValue: string;
  onComposerValueChange: (agentId: AgentId, value: string) => void;
  onMarketingWorkChange?: (workId: string | null) => void;
};

const statusMeta: Record<AgentWorkStatus, { label: string; dot: string }> = {
  idle: { label: "空闲，可以开始新的工作", dot: "bg-[#5f88b0]" },
  working: { label: "正在工作", dot: "bg-[#d6a43c] animate-pulse" },
  completed: { label: "刚完成一项工作，等待查看", dot: "bg-[#4f9a68]" },
  error: { label: "工作遇到问题，需要查看", dot: "bg-[#bd5b50]" },
};

export function AgentWorkspace({
  project,
  openAgents,
  activeAgent,
  completedAgents,
  messages,
  tasks,
  saved,
  onSave,
  onHandoff,
  onCloseAgent,
  onActivateAgent,
  onSendMessage,
  generatingAgents,
  agentErrors,
  loadingAgents,
  onAddAgent,
  projectId,
  onNotice,
  conversationIds,
  onConversationChange,
  onReturnHandoff,
  onCodingReply,
  onCodingExecutionState,
  isPreparingSave,
  preparingHandoff,
  agentProgress,
  agentStartedAt,
  composerValue,
  onComposerValueChange,
  onMarketingWorkChange,
}: AgentWorkspaceProps) {
  const getStatus = (agentId: AgentId): AgentWorkStatus => {
    if (agentErrors[agentId]) return "error";
    if (generatingAgents[agentId] || loadingAgents[agentId]) return "working";
    if (completedAgents[agentId]) return "completed";
    return "idle";
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-[#f8f8f5]">
      <div className="flex h-[44px] shrink-0 items-end border-b border-[#dfded9] bg-[#efefec] px-3 pt-1.5">
        <div className="agent-tab-strip flex min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden">
          {openAgents.map((agentId) => {
            const meta = agentMeta[agentId];
            const status = getStatus(agentId);
            const statusDescription = agentProgress[agentId] || agentErrors[agentId] || statusMeta[status].label;
            const selected = activeAgent === agentId;
            return (
              <div
                key={agentId}
                className={`group flex h-[36px] min-w-[150px] max-w-[210px] items-center rounded-t-[8px] border border-b-0 px-2.5 ${selected ? "border-[#dfded9] bg-white text-[#34342f]" : "border-transparent bg-[#e8e8e4] text-[#6f6e67] hover:bg-[#e3e3df]"}`}
              >
                <button type="button" onClick={() => onActivateAgent(agentId)} className="flex min-w-0 flex-1 items-center gap-2 rounded-[5px] text-left outline-none focus:outline-none focus-visible:bg-[#f1f3ef] focus-visible:outline-none">
                  <AgentAvatar agentId={agentId} initials={meta.initials} className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-white/80 text-micro font-semibold text-[#55554f] ring-1 ring-black/[0.05]" />
                  <span className="truncate text-control font-medium">{meta.name}</span>
                </button>
                <span className="relative ml-2 flex shrink-0 items-center">
                  <span aria-label={statusDescription} title={statusDescription} className={`h-2 w-2 rounded-full ring-2 ring-white/80 ${statusMeta[status].dot}`} />
                  <span className="pointer-events-none absolute right-0 top-5 z-30 hidden w-max max-w-[240px] rounded-md bg-[#282824] px-2 py-1.5 text-caption leading-4 text-white shadow-lg group-hover:block">{statusDescription}</span>
                </span>
                <button type="button" aria-label={`关闭 ${meta.name}`} title="关闭标签（不会删除对话或中断工作）" onClick={() => onCloseAgent(agentId)} className="ml-1.5 grid h-5 w-5 shrink-0 place-items-center rounded text-body text-[#aaa9a1] hover:bg-black/[0.06] hover:text-[#55554f]">×</button>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={onAddAgent} className="mb-1 ml-1 flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-control font-medium text-[#68675f] hover:bg-white/70">
          <span className="text-section-title">＋</span> 添加 Agent
        </button>
      </div>

      {activeAgent && openAgents.includes(activeAgent) ? (
        <div className="flex min-h-0 flex-1 bg-white">
          <AgentPanel
            key={`${project.id}-${activeAgent}`}
            agentId={activeAgent}
            messages={messages[activeAgent]}
            tasks={tasks[activeAgent]}
            saved={saved}
            onSave={onSave}
            onHandoff={onHandoff}
            onClose={() => onCloseAgent(activeAgent)}
            canClose={false}
            onSendMessage={onSendMessage}
            isGenerating={generatingAgents[activeAgent] === true}
            error={agentErrors[activeAgent]}
            isLoadingHistory={loadingAgents[activeAgent] === true}
            projectId={projectId}
            onNotice={onNotice}
            conversationId={conversationIds[activeAgent]}
            onConversationChange={onConversationChange}
            onReturnHandoff={onReturnHandoff}
            onCodingReply={onCodingReply}
            onCodingExecutionState={onCodingExecutionState}
            isPreparingSave={activeAgent === "planner" ? isPreparingSave : undefined}
            preparingHandoff={activeAgent === "planner" ? preparingHandoff : undefined}
            progressMessage={agentProgress[activeAgent]}
            startedAt={agentStartedAt[activeAgent]}
            composerValue={composerValue}
            onComposerValueChange={(value) => onComposerValueChange(activeAgent, value)}
          />
          {activeAgent === "buyer" && (
            <div className="h-full min-w-[410px] w-[46%] shrink-0 border-l border-[#dfded9]">
              <ProcurementInquiryPanel
                projectId={projectId}
                disabled={generatingAgents.buyer === true || loadingAgents.buyer === true || !projectId}
                onNotice={onNotice}
                onReferenceTarget={(text) => {
                  onComposerValueChange("buyer", composerValue.trim() ? `${composerValue.trim()}\n\n${text}` : text);
                  onNotice("已引用到左侧输入框，你可以继续补充想讨论的问题");
                }}
                refreshKey={messages.buyer.length}
              />
            </div>
          )}
          {activeAgent === "marketing" && (
            <div className="h-full min-w-[430px] w-[46%] shrink-0 border-l border-[#dfded9]">
              <MarketingContentPanel
                projectId={projectId}
                disabled={generatingAgents.marketing === true || loadingAgents.marketing === true || !projectId}
                onNotice={onNotice}
                onActiveWorkChange={onMarketingWorkChange}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center bg-white p-8">
          <div className="max-w-[380px] text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-[10px] border border-[#e2e1dc] bg-[#f7f7f4] text-[19px] text-[#77766f]">＋</div>
            <p className="mt-4 text-body font-semibold text-[#44443f]">按需要打开一个 Agent</p>
            <p className="mt-1.5 text-control leading-5 text-[#999890]">Agent 是这个项目里的工作工具。关闭标签不会删除对话，也不会中断已经开始的工作。</p>
            <button type="button" onClick={onAddAgent} className="mt-4 h-8 rounded-md bg-[#243f34] px-3 text-control font-medium text-white">添加 Agent</button>
          </div>
        </div>
      )}
    </main>
  );
}
