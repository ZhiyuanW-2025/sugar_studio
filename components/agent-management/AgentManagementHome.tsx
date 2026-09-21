import Link from "next/link";
import { agentDefinitions } from "../../lib/agents/catalog";
import { AgentAvatar } from "../AgentAvatar";

export function AgentManagementHome() {
  return (
    <div className="mx-auto w-full max-w-[920px] px-8 py-10">
      <div className="mb-9">
        <p className="text-body font-medium uppercase tracking-[0.14em] text-[#999890]">工作室设置</p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.04em]">Agent 管理</h1>
        <p className="mt-2 max-w-[620px] text-body leading-6 text-[#73736d]">
          查看全局 Agent 的职责与提示词，以及你自己的模型偏好、知识来源与可用工具。
        </p>
      </div>

      <div className="divide-y divide-[#e7e6e1] border-y border-[#deddd7]">
        {agentDefinitions.map((agent) => (
          <Link
            key={agent.type}
            href={`/settings/agents/${agent.slug}`}
            className="group flex items-center gap-4 py-5"
          >
            <AgentAvatar agentType={agent.type} initials={agent.initials} className="grid h-11 w-11 shrink-0 place-items-center rounded-[9px] border border-[#dfded8] bg-[#f7f7f4] text-body font-semibold text-[#55554f]" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-panel-title font-semibold text-[#34342f]">{agent.name}</span>
                <span className="rounded border border-[#e4e3de] px-1.5 py-0.5 text-caption text-[#8e8d85]">{agent.roleTitle}</span>
              </span>
              <span className="mt-1 block text-body text-[#85847c]">{agent.description}</span>
            </span>
            <span className="text-body text-[#929189] group-hover:text-[#34342f]">管理 →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
