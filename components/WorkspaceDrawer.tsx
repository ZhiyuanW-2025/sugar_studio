import { useEffect } from "react";
import type { ActivityItem, DrawerId, Project } from "./types";

type WorkspaceDrawerProps = {
  drawer: Exclude<DrawerId, null>;
  project: Project;
  activity: ActivityItem[];
  onClose: () => void;
  onNotice: (message: string) => void;
};

const FileMark = ({ extension }: { extension: string }) => (
  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[7px] border border-[#e2e1dc] bg-[#f8f8f5] text-[8px] font-semibold uppercase tracking-[0.06em] text-[#78776f]">
    {extension}
  </div>
);

export function WorkspaceDrawer({ drawer, project, activity, onClose, onNotice }: WorkspaceDrawerProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const titles = {
    brain: ["当前项目知识", "所有 Agent 共享同一份已确认信息"],
    files: ["项目资料", "当前工作区可读取的项目文件"],
    activity: ["活动记录", "当前会话中的协作动态"],
  } as const;

  return (
    <>
      <button type="button" aria-label="关闭抽屉" onClick={onClose} className="fixed inset-0 z-30 cursor-default bg-[#161613]/10" />
      <aside className="panel-in fixed bottom-0 right-0 top-0 z-40 flex w-[380px] flex-col border-l border-[#deddd8] bg-white shadow-[-20px_0_60px_rgba(20,20,16,0.09)]" aria-label={titles[drawer][0]}>
        <header className="flex h-[70px] shrink-0 items-center border-b border-[#e8e7e2] px-5">
          <div>
            <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-[#292925]">{titles[drawer][0]}</h2>
            <p className="mt-1 text-[10px] text-[#999890]">{titles[drawer][1]}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="ml-auto grid h-8 w-8 place-items-center rounded-md text-[18px] text-[#8c8b83] hover:bg-[#f3f3f0]">×</button>
        </header>

        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {drawer === "brain" && (
            <div>
              <div className="mb-6 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-[9px] bg-[#f0f0ec] text-[13px] font-semibold text-[#5f5e58]">{project.short}</div>
                <div>
                  <p className="text-[11px] text-[#999890]">项目</p>
                  <p className="mt-0.5 text-[13px] font-medium text-[#33332f]">{project.name}</p>
                </div>
              </div>
              <p className="mb-2.5 text-[10px] font-medium uppercase tracking-[0.1em] text-[#999890]">当前确认内容</p>
              <div className="divide-y divide-[#ecebe7] border-y border-[#ecebe7]">
                {project.knowledge.map((item) => (
                  <div key={item} className="flex gap-3 py-3 text-[12px] leading-5 text-[#55554f]">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#5d806f]" />
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-[8px] bg-[#f5f7f5] p-3 text-[10px] leading-[1.6] text-[#718078]">
                这些信息会自动成为当前工作台中所有 Agent 的共享上下文。
              </div>
            </div>
          )}

          {drawer === "files" && (
            <div className="divide-y divide-[#ecebe7] border-y border-[#ecebe7]">
              {project.files.map((file) => {
                const extension = file.name.split(".").pop() ?? "FILE";
                return (
                  <button key={file.name} type="button" onClick={() => onNotice("Demo 中的项目文件仅作展示")} className="flex w-full items-center gap-3 py-3 text-left hover:bg-[#fafaf8]">
                    <FileMark extension={extension} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-[#44443f]">{file.name}</span>
                      <span className="mt-1 block text-[10px] text-[#aaa9a1]">{file.meta}</span>
                    </span>
                    <span className="text-[13px] text-[#aaa9a1]">↗</span>
                  </button>
                );
              })}
            </div>
          )}

          {drawer === "activity" && (
            <div className="relative">
              <div className="absolute bottom-3 left-[43px] top-3 w-px bg-[#e5e4df]" />
              {activity.map((item, index) => (
                <div key={`${item.time}-${item.text}-${index}`} className="relative flex gap-4 py-3">
                  <time className="w-7 shrink-0 pt-0.5 font-mono text-[9px] text-[#aaa9a1]">{item.time}</time>
                  <span className="relative z-10 mt-1.5 h-2 w-2 shrink-0 rounded-full border-2 border-white bg-[#7b8f85] ring-1 ring-[#d6ddd9]" />
                  <p className="text-[11px] leading-5 text-[#5c5b55]">{item.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {drawer === "brain" && (
          <footer className="border-t border-[#e8e7e2] p-4">
            <button type="button" onClick={() => onNotice("完整项目知识将在后续版本开放")} className="h-9 w-full rounded-md border border-[#deddd7] text-[11px] font-medium text-[#55554f] hover:bg-[#f5f5f2]">查看全部项目知识</button>
          </footer>
        )}
      </aside>
    </>
  );
}
