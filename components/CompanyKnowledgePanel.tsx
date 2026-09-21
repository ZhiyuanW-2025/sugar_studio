"use client";

import { KnowledgeFilesPanel } from "./KnowledgeFilesPanel";
import { FeishuKnowledgePanel } from "./FeishuKnowledgePanel";

export function CompanyKnowledgePanel({ onNotice }: { onNotice: (message: string) => void }) {
  return (
    <div>
      <div className="mb-4 rounded-[8px] bg-[#f5f7f5] p-3 text-control leading-[1.65] text-[#68776f]">
        公司共享资料对所有工作室成员开放，可像项目材料一样被 Agent 使用。适合上传工作室介绍、服务能力、案例说明、标准流程和材料模板。
      </div>
      <FeishuKnowledgePanel scopeType="company" onNotice={onNotice} />
      <KnowledgeFilesPanel
        listEndpoint="/api/knowledge/company-files"
        uploadEndpoint="/api/knowledge/company-files"
        fileUrl={(id) => `/api/knowledge/company-files/${id}`}
        emptyTitle="还没有公司共享资料"
        emptyDescription="上传后，所有项目中的 Agent 都可以把它当作项目材料检索"
        uploadNotice="文件已上传到公司共享资料"
        onNotice={onNotice}
      />
    </div>
  );
}
