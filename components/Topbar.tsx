import type { Project, ProjectSection } from "./types";

type TopbarProps = {
  project: Project;
  section: ProjectSection;
  onSectionChange: (section: ProjectSection) => void;
  onOpenProjectSettings: () => void;
};

const sections: Array<{ id: ProjectSection; label: string; description: string }> = [
  { id: "workspace", label: "开始工作", description: "打开 Agent 工作区" },
  { id: "files", label: "项目材料", description: "项目简介、文件与飞书知识库" },
  { id: "activity", label: "进度记录", description: "成员和 Agent 的共享工作记录" },
  { id: "repository", label: "代码仓库", description: "远程仓库与我的本地工作目录" },
];

export function Topbar({ project, section, onSectionChange, onOpenProjectSettings }: TopbarProps) {
  return (
    <header className="relative z-20 flex h-[60px] shrink-0 items-stretch border-b border-[#e4e3de] bg-white px-5">
      <button type="button" onClick={() => onSectionChange("workspace")} className="mr-6 flex min-w-[170px] items-center gap-2.5 text-left">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] border border-[#dde2de] bg-[#f0f4f1] text-body font-semibold text-[#426656]">{project.short}</span>
        <span className="min-w-0">
          <span className="block truncate text-body font-semibold tracking-[-0.015em] text-[#2c2c28]">{project.name}</span>
          <span className="mt-0.5 block truncate text-caption text-[#999890]">{project.currentStage || "项目进行中"}</span>
        </span>
      </button>

      <nav aria-label="项目功能" className="flex items-stretch gap-1">
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.description}
            onClick={() => onSectionChange(item.id)}
            className={`relative px-3 text-body font-medium transition-colors ${section === item.id ? "text-[#2f4f42]" : "text-[#77766f] hover:text-[#34342f]"}`}
          >
            {item.label}
            {section === item.id && <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-t bg-[#426b59]" />}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <span className={`rounded-full px-2 py-1 text-micro font-medium ${project.status === "archived" ? "bg-[#f1efeb] text-[#8e8275]" : "bg-[#edf4f0] text-[#50715f]"}`}>{project.status === "archived" ? "已归档" : "进行中"}</span>
        <button type="button" onClick={onOpenProjectSettings} aria-label="项目设置" title="项目设置与成员" className="grid h-8 w-8 place-items-center rounded-md text-[16px] text-[#7f7e76] hover:bg-[#f5f5f2]">···</button>
      </div>
    </header>
  );
}
