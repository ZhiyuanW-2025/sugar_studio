"use client";

import { ProjectMaterialsPanel } from "./ProjectMaterialsPanel";

type ProjectFilesPanelProps = {
  projectId: string | null;
  onNotice: (message: string) => void;
};

export function ProjectFilesPanel({ projectId, onNotice }: ProjectFilesPanelProps) {
  if (!projectId) {
    return <p className="text-body leading-5 text-[#999890]">当前演示项目尚未连接文件存储。</p>;
  }

  return <ProjectMaterialsPanel projectId={projectId} onNotice={onNotice} />;
}
