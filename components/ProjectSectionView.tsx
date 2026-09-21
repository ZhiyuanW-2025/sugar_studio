"use client";

import { useState } from "react";
import { ProjectActivityPanel } from "./ProjectActivityPanel";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { ProjectRepositoryPanel } from "./ProjectRepositoryPanel";
import type { Project, ProjectSection } from "./types";

type Props = {
  section: Exclude<ProjectSection, "workspace">;
  project: Project;
  onNotice: (message: string) => void;
  onProjectUpdated: (project: Project) => void;
};

const sectionCopy = {
  files: ["项目材料", "当前项目工作空间中 Agent 可使用的材料。"],
  activity: ["进度记录", "当前项目中所有成员与 Agent 的工作进展，向项目成员实时同步。"],
  repository: ["代码仓库", "远程仓库属于项目；本地工作目录只保存在当前用户的工作环境。"],
} as const;

export function ProjectSectionView({ section, project, onNotice, onProjectUpdated }: Props) {
  const [title, description] = sectionCopy[section];
  const [editingDescription, setEditingDescription] = useState(false);
  const [projectDescription, setProjectDescription] = useState(project.description);
  const [savingDescription, setSavingDescription] = useState(false);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [editingStage, setEditingStage] = useState(false);
  const [currentStage, setCurrentStage] = useState(project.currentStage);
  const [savingStage, setSavingStage] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);

  const saveProjectDescription = async () => {
    if (savingDescription) return;
    setSavingDescription(true);
    setDescriptionError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: projectDescription.trim() }),
      });
      const payload = await response.json().catch(() => null) as { project?: Project; error?: string } | null;
      if (!response.ok || !payload?.project) throw new Error(payload?.error || "项目简介保存失败。");
      onProjectUpdated(payload.project);
      setProjectDescription(payload.project.description);
      setEditingDescription(false);
      onNotice("项目简介已保存");
    } catch (error) {
      setDescriptionError(error instanceof Error ? error.message : "项目简介保存失败。");
    } finally {
      setSavingDescription(false);
    }
  };

  const saveCurrentStage = async () => {
    if (savingStage) return;
    setSavingStage(true);
    setStageError(null);
    try {
      const normalizedStage = currentStage.trim();
      const response = await fetch(`/api/projects/${project.id}/brain`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: project.summary, currentStage: normalizedStage }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "当前阶段保存失败。");
      onProjectUpdated({
        ...project,
        currentStage: normalizedStage,
        knowledge: [
          normalizedStage ? `当前项目阶段：${normalizedStage}` : "",
          project.summary,
          project.currentPlanSummary,
        ].filter(Boolean),
      });
      setCurrentStage(normalizedStage);
      setEditingStage(false);
      onNotice("当前阶段已保存");
    } catch (error) {
      setStageError(error instanceof Error ? error.message : "当前阶段保存失败。");
    } finally {
      setSavingStage(false);
    }
  };

  return (
    <main className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto bg-[#f8f8f5]">
      <div className="mx-auto w-full max-w-[1040px] px-8 py-8">
        <header className="mb-7 flex items-start gap-4 border-b border-[#e4e3de] pb-6">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[9px] border border-[#dce1dd] bg-[#edf2ef] text-body font-semibold text-[#426656]">{project.short}</div>
          <div className="min-w-0">
            <p className="text-control font-medium text-[#999890]">{project.name}</p>
            <h1 className="mt-1 text-page-title font-semibold tracking-[-0.025em] text-[#292925]">{title}</h1>
            <p className="mt-1.5 text-body leading-5 text-[#85847c]">{description}</p>
          </div>
        </header>

        {section === "files" && (
          <div className="space-y-7">
            <section className="rounded-[9px] border border-[#e2e1dc] bg-white p-5">
              <div className="flex items-start gap-5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-control font-medium uppercase tracking-[0.1em] text-[#aaa9a1]">项目简介</p>
                    {!editingDescription && (
                      <button type="button" onClick={() => setEditingDescription(true)} className="rounded-md border border-[#deddd8] px-2.5 py-1 text-control font-medium text-[#66655e] transition-colors hover:border-[#bdbcb5] hover:bg-[#f7f7f4]">
                        编辑
                      </button>
                    )}
                  </div>
                  {editingDescription ? (
                    <div className="mt-3">
                      <textarea
                        value={projectDescription}
                        maxLength={2000}
                        rows={5}
                        autoFocus
                        onChange={(event) => setProjectDescription(event.target.value)}
                        className="w-full resize-y rounded-md border border-[#d8d7d1] px-3 py-2.5 text-body leading-6 text-[#55554f] outline-none focus:border-[#9aa9a1]"
                        placeholder="填写项目简介…"
                      />
                      {descriptionError && <p className="mt-2 text-control text-[#a45b49]">{descriptionError}</p>}
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={savingDescription}
                          onClick={() => {
                            setProjectDescription(project.description);
                            setEditingDescription(false);
                            setDescriptionError(null);
                          }}
                          className="h-8 rounded-md border border-[#deddd8] px-3 text-control font-medium text-[#66655e] disabled:opacity-40"
                        >
                          取消
                        </button>
                        <button type="button" aria-busy={savingDescription} disabled={savingDescription} onClick={() => void saveProjectDescription()} className="h-8 rounded-md bg-[#243f34] px-3 text-control font-medium text-white disabled:opacity-40">
                          {savingDescription ? "保存中…" : "保存"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap text-body leading-6 text-[#55554f]">{project.description || project.summary || "暂未填写项目简介。"}</p>
                  )}
                </div>
                <div className="w-[240px] shrink-0 border-l border-[#ecebe7] pl-5 text-control leading-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[#999890]">当前阶段</p>
                    {!editingStage && (
                      <button type="button" onClick={() => setEditingStage(true)} className="rounded-md border border-[#deddd8] px-2 py-0.5 font-medium text-[#66655e] transition-colors hover:border-[#bdbcb5] hover:bg-[#f7f7f4]">
                        编辑
                      </button>
                    )}
                  </div>
                  {editingStage ? (
                    <div className="mt-2">
                      <input
                        value={currentStage}
                        maxLength={200}
                        autoFocus
                        onChange={(event) => setCurrentStage(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.nativeEvent.isComposing) void saveCurrentStage();
                        }}
                        className="h-9 w-full rounded-md border border-[#d8d7d1] px-2.5 text-body text-[#4d4c46] outline-none focus:border-[#9aa9a1]"
                        placeholder="填写当前阶段…"
                      />
                      {stageError && <p className="mt-1.5 text-caption leading-4 text-[#a45b49]">{stageError}</p>}
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={savingStage}
                          onClick={() => {
                            setCurrentStage(project.currentStage);
                            setEditingStage(false);
                            setStageError(null);
                          }}
                          className="h-7 rounded-md border border-[#deddd8] px-2.5 font-medium text-[#66655e] disabled:opacity-40"
                        >
                          取消
                        </button>
                        <button type="button" aria-busy={savingStage} disabled={savingStage} onClick={() => void saveCurrentStage()} className="h-7 rounded-md bg-[#243f34] px-2.5 font-medium text-white disabled:opacity-40">
                          {savingStage ? "保存中…" : "保存"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 font-medium text-[#4d4c46]">{project.currentStage || "尚未填写"}</p>
                  )}
                </div>
              </div>
            </section>
            <ProjectFilesPanel projectId={project.id} onNotice={onNotice} />
          </div>
        )}

        {section === "activity" && (
          <section className="rounded-[9px] border border-[#e2e1dc] bg-white px-5 py-2">
            <ProjectActivityPanel projectId={project.id} />
          </section>
        )}

        {section === "repository" && (
          <section className="rounded-[9px] border border-[#e2e1dc] bg-white p-5">
            <ProjectRepositoryPanel projectId={project.id} onNotice={onNotice} />
          </section>
        )}
      </div>
    </main>
  );
}
