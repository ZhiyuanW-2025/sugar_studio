import { useEffect, useRef, useState } from "react";
import { projects } from "./mockData";

type TopbarProps = {
  projectId: string;
  openAgentCount: number;
  onProjectChange: (id: string) => void;
  onAddAgent: () => void;
  onNotice: (message: string) => void;
};

export function Topbar({
  projectId,
  openAgentCount,
  onProjectChange,
  onAddAgent,
  onNotice,
}: TopbarProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = projects.find((project) => project.id === projectId) ?? projects[0];

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <header className="relative z-20 flex h-[58px] shrink-0 items-center border-b border-[#e7e6e1] bg-white px-5">
      <div ref={ref} className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-left hover:bg-[#f5f5f2]"
        >
          <span className="text-[11px] text-[#8f8e86]">当前项目</span>
          <span className="text-[13px] font-medium text-[#2c2c28]">{current.name}</span>
          <span className={`text-[10px] text-[#9a9991] transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
        </button>

        {open && (
          <div className="panel-in absolute left-0 top-11 w-[260px] rounded-[10px] border border-[#dfded8] bg-white p-1.5 shadow-[0_16px_46px_rgba(26,26,22,0.14)]">
            <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#aaa9a1]">
              切换项目
            </p>
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                role="option"
                aria-selected={project.id === projectId}
                onClick={() => {
                  onProjectChange(project.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-[#f5f5f2]"
              >
                <span className="grid h-7 w-7 place-items-center rounded-md border border-[#e3e2dc] bg-[#f7f7f4] text-[11px] font-semibold text-[#64635d]">
                  {project.short}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-[#363631]">{project.name}</span>
                {project.id === projectId && <span className="text-[12px] text-[#30614f]">✓</span>}
              </button>
            ))}
            <div className="my-1 border-t border-[#ecebe6]" />
            <button
              type="button"
              onClick={() => {
                onNotice("新建项目功能将在后续版本开放");
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-[#696861] hover:bg-[#f5f5f2]"
            >
              <span className="grid h-7 w-7 place-items-center text-[18px] text-[#9a9991]">＋</span>
              新建项目
            </button>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="mr-2 flex items-center gap-1.5 text-[11px] text-[#999890]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#568a75]" />
          {openAgentCount} 个 Agent 协作中
        </div>
        <button
          type="button"
          onClick={onAddAgent}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[#dfded8] bg-white px-3 text-[12px] font-medium text-[#393934] shadow-[0_1px_1px_rgba(0,0,0,0.03)] transition-colors hover:bg-[#f5f5f2]"
        >
          <span className="text-[16px] leading-none text-[#73726b]">＋</span>
          添加 Agent
        </button>
        <button
          type="button"
          onClick={() => onNotice("更多设置将在后续版本开放")}
          aria-label="更多设置"
          className="grid h-8 w-8 place-items-center rounded-md text-[17px] text-[#7f7e76] hover:bg-[#f5f5f2]"
        >
          ···
        </button>
      </div>
    </header>
  );
}
