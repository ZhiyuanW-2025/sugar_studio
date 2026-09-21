import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DrawerId, Project } from "./types";

type SidebarProps = {
  projects: Project[];
  projectId: string;
  activeDrawer: DrawerId;
  currentUser: {
    displayName: string;
    email: string;
    avatarUrl: string | null;
    role: "project_lead" | "member";
  };
  isSigningOut: boolean;
  isCreatingProject: boolean;
  onProjectChange: (projectId: string) => void;
  onCreateProject: (name: string, description: string) => Promise<boolean>;
  onOpenDrawer: (drawer: Exclude<DrawerId, null>) => void;
  onSignOut: () => void;
};

const getInitials = (displayName: string) =>
  Array.from(displayName.trim()).slice(0, 2).join("").toUpperCase() || "S";

export function Sidebar({
  projects,
  projectId,
  activeDrawer,
  currentUser,
  isSigningOut,
  isCreatingProject,
  onProjectChange,
  onCreateProject,
  onOpenDrawer,
  onSignOut,
}: SidebarProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const createRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!createRef.current?.contains(event.target as Node)) setCreateOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const settingsLink = (href: string, label: string, icon: string) => (
    <Link
      href={href}
      className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-body text-[#85847c] hover:bg-[#e9e9e5] hover:text-[#34342f]"
    >
      <span className="flex h-5 w-5 items-center justify-center text-body" aria-hidden="true">{icon}</span>
      {label}
    </Link>
  );

  return (
    <aside className="flex w-[228px] shrink-0 flex-col border-r border-[#e4e3de] bg-[#f3f3f0] px-3 pb-4 pt-5">
      <div className="mb-6 flex h-8 items-center gap-2.5 px-2">
        <div className="grid h-7 w-7 place-items-center rounded-[7px] bg-[#1d1d1a] text-body font-semibold text-white">S</div>
        <div>
          <div className="text-panel-title font-semibold tracking-[-0.02em] text-[#1f1f1c]">Sugar Agent</div>
          <div className="mt-0.5 text-caption uppercase tracking-[0.15em] text-[#a2a199]">Project Workspace</div>
        </div>
      </div>

      <nav aria-label="项目导航" className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center px-2.5">
          <p className="text-control font-medium uppercase tracking-[0.13em] text-[#aaa9a1]">项目</p>
          <span className="ml-auto text-caption text-[#b2b1aa]">{projects.length}</span>
        </div>

        <div className="subtle-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto pr-0.5">
          {projects.map((project) => {
            const selected = project.id === projectId;
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => onProjectChange(project.id)}
                className={`group mb-0.5 flex min-h-10 w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left transition-colors ${selected ? "bg-white text-[#242420] shadow-[0_1px_1px_rgba(20,20,18,0.04)] ring-1 ring-black/[0.035]" : "text-[#6f6e67] hover:bg-[#ebebe7] hover:text-[#363631]"}`}
              >
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-[6px] border text-caption font-semibold ${selected ? "border-[#d9dedb] bg-[#edf2ef] text-[#426656]" : "border-[#deddd7] bg-[#f8f8f5] text-[#85847c]"}`}>
                  {project.short}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">{project.name}</span>
                  <span className="mt-0.5 block truncate text-micro text-[#aaa9a1]">{project.status === "archived" ? "已归档" : project.currentStage || "进行中"}</span>
                </span>
                {selected && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#4f7865]" aria-label="当前项目" />}
              </button>
            );
          })}
        </div>

        <div ref={createRef} className="relative mt-2">
          <button
            type="button"
            onClick={() => setCreateOpen((value) => !value)}
            className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-body font-medium text-[#65645e] hover:bg-[#e9e9e5]"
          >
            <span className="grid h-5 w-5 place-items-center text-[17px] text-[#8e8d85]">＋</span>
            新建项目
          </button>
          {createOpen && (
            <form
              className="panel-in absolute bottom-11 left-0 z-40 w-[300px] space-y-2 rounded-[10px] border border-[#deddd7] bg-white p-3 shadow-[0_18px_52px_rgba(22,22,18,0.15)]"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!projectName.trim()) return;
                const created = await onCreateProject(projectName.trim(), projectDescription.trim());
                if (created) {
                  setProjectName("");
                  setProjectDescription("");
                  setCreateOpen(false);
                }
              }}
            >
              <div>
                <p className="text-body font-semibold text-[#34342f]">新建项目</p>
                <p className="mt-1 text-caption text-[#999890]">项目材料、进度和 Agent 对话都会独立保存。</p>
              </div>
              <input autoFocus value={projectName} maxLength={120} onChange={(event) => setProjectName(event.target.value)} placeholder="项目名称" className="h-9 w-full rounded-md border border-[#deddd8] px-2.5 text-body outline-none focus:border-[#9aa9a1]" />
              <textarea value={projectDescription} maxLength={2000} onChange={(event) => setProjectDescription(event.target.value)} placeholder="项目简介（可选）" rows={3} className="w-full resize-none rounded-md border border-[#deddd8] px-2.5 py-2 text-body leading-5 outline-none focus:border-[#9aa9a1]" />
              <div className="flex justify-end gap-1.5 pt-1">
                <button type="button" onClick={() => setCreateOpen(false)} className="h-7 px-2 text-control text-[#77766f]">取消</button>
                <button type="submit" aria-busy={isCreatingProject} disabled={isCreatingProject || !projectName.trim()} className="h-7 rounded-md bg-[#243f34] px-2.5 text-control font-medium text-white disabled:opacity-40">{isCreatingProject ? "创建中…" : "创建项目"}</button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-3 border-t border-[#e1e0db] pt-3">
          <button
            type="button"
            onClick={() => onOpenDrawer("activity")}
            className={`flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-body ${activeDrawer === "activity" ? "bg-[#e7e7e3] font-medium text-[#34342f]" : "text-[#85847c] hover:bg-[#e9e9e5] hover:text-[#34342f]"}`}
          >
            <span className="flex h-5 w-5 items-center justify-center text-body" aria-hidden="true">↗</span>
            我的工作日志
          </button>
          {settingsLink("/settings/agents", "Agent 管理", "◇")}
          {settingsLink("/settings/account", "账户设置", "⌁")}
          {settingsLink("/settings/models", "模型设置", "⌁")}
        </div>
      </nav>

      <div className="mt-4 flex items-center gap-2.5 border-t border-[#e1e0db] px-2 pt-3">
        {currentUser.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentUser.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
        ) : (
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#dddcd5] text-control font-semibold text-[#55554f]">{getInitials(currentUser.displayName)}</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-[#4d4c46]">{currentUser.displayName}</p>
          <p className="truncate text-caption text-[#aaa9a1]">{currentUser.role === "project_lead" ? "项目负责人" : "项目成员"}</p>
        </div>
        <button type="button" onClick={onSignOut} disabled={isSigningOut} title="退出登录" aria-label="退出登录" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-panel-title text-[#999890] hover:bg-[#e8e8e3] hover:text-[#4d4c46] disabled:opacity-50">↪</button>
      </div>
    </aside>
  );
}
