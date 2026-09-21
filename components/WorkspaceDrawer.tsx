import { useEffect } from "react";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { CompanyKnowledgePanel } from "./CompanyKnowledgePanel";
import { ProjectActivityPanel } from "./ProjectActivityPanel";
import { ProjectRepositoryPanel } from "./ProjectRepositoryPanel";
import { ProjectBrainPanel } from "./ProjectBrainPanel";
import { KnowledgeSearchPanel } from "./KnowledgeSearchPanel";
import { CollaborationTasksPanel } from "./CollaborationTasksPanel";
import type { ActivityItem, DrawerId } from "./types";

type WorkspaceDrawerProps = {
  drawer: Exclude<DrawerId, null>;
  activity: ActivityItem[];
  databaseProjectId: string | null;
  onClose: () => void;
  onNotice: (message: string) => void;
};

export function WorkspaceDrawer({ drawer, activity, databaseProjectId, onClose, onNotice }: WorkspaceDrawerProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const titles = {
    brain: ["当前项目知识", "所有 Agent 共享同一份已确认信息"],
    files: ["项目材料", "当前工作区可读取的项目材料"],
    knowledgeSearch: ["知识检索", "搜索当前项目与工作室资料"],
    companyKnowledge: ["公司共享资料", "作为所有项目都能读取的公共项目材料"],
    repository: ["代码仓库", "当前项目的本地 Git 仓库绑定"],
    activity: ["我的工作日志", "只记录你在各个项目中的工作"],
    collaboration: ["协作任务", "Agent 之间已确认的任务流转"],
  } as const;

  return (
    <>
      <button type="button" aria-label="关闭抽屉" onClick={onClose} className="fixed inset-0 z-30 cursor-default bg-[#161613]/10" />
      <aside className="panel-in fixed bottom-0 right-0 top-0 z-40 flex w-[380px] flex-col border-l border-[#deddd8] bg-white shadow-[-20px_0_60px_rgba(20,20,16,0.09)]" aria-label={titles[drawer][0]}>
        <header className="flex h-[70px] shrink-0 items-center border-b border-[#e8e7e2] px-5">
          <div>
            <h2 className="text-panel-title font-semibold tracking-[-0.02em] text-[#292925]">{titles[drawer][0]}</h2>
            <p className="mt-1 text-control text-[#999890]">{titles[drawer][1]}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="ml-auto grid h-8 w-8 place-items-center rounded-md text-[18px] text-[#8c8b83] hover:bg-[#f3f3f0]">×</button>
        </header>

        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {drawer === "brain" && (
            databaseProjectId ? <ProjectBrainPanel projectId={databaseProjectId} onNotice={onNotice} /> : null
          )}

          {drawer === "files" && (
            <ProjectFilesPanel projectId={databaseProjectId} onNotice={onNotice} />
          )}

          {drawer === "companyKnowledge" && (
            <CompanyKnowledgePanel onNotice={onNotice} />
          )}

          {drawer === "knowledgeSearch" && databaseProjectId && (
            <KnowledgeSearchPanel projectId={databaseProjectId} />
          )}

          {drawer === "repository" && (
            <ProjectRepositoryPanel projectId={databaseProjectId} onNotice={onNotice} />
          )}

          {drawer === "collaboration" && databaseProjectId && (
            <CollaborationTasksPanel projectId={databaseProjectId} onNotice={onNotice} />
          )}

          {drawer === "activity" && (
            databaseProjectId ? (
              <ProjectActivityPanel mine />
            ) : <div className="relative">
              <div className="absolute bottom-3 left-[43px] top-3 w-px bg-[#e5e4df]" />
              {activity.map((item, index) => (
                <div key={`${item.time}-${item.text}-${index}`} className="relative flex gap-4 py-3">
                  <time className="w-7 shrink-0 pt-0.5 font-mono text-caption text-[#aaa9a1]">{item.time}</time>
                  <span className="relative z-10 mt-1.5 h-2 w-2 shrink-0 rounded-full border-2 border-white bg-[#7b8f85] ring-1 ring-[#d6ddd9]" />
                  <p className="text-body leading-5 text-[#5c5b55]">{item.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>

      </aside>
    </>
  );
}
