"use client";

import { useEffect } from "react";

export type PlanSavePreview = {
  sourceThreadId: string;
  content: string;
  currentPlanSummary: string;
  changeSummary: string;
  nextVersion: number;
};

type PlanSaveModalProps = {
  preview: PlanSavePreview;
  isSaving: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function PlanSaveModal({
  preview,
  isSaving,
  error,
  onCancel,
  onConfirm,
}: PlanSaveModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, onCancel]);

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[#151512]/20 p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-save-title"
        className="panel-in flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[12px] border border-[#d9d8d2] bg-white shadow-[0_30px_90px_rgba(20,20,16,0.22)]"
      >
        <header className="flex items-start border-b border-[#e8e7e2] px-5 py-4">
          <div>
            <h2 id="plan-save-title" className="text-section-title font-semibold text-[#292925]">
              保存为当前方案
            </h2>
            <p className="mt-1 text-control text-[#999890]">
              确认后将创建正式版本 v{preview.nextVersion}，旧版本会继续保留
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            disabled={isSaving}
            onClick={onCancel}
            className="ml-auto grid h-8 w-8 place-items-center rounded-md text-[18px] text-[#8c8b83] hover:bg-[#f3f3f0] disabled:opacity-40"
          >
            ×
          </button>
        </header>

        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <p className="mb-2 text-control font-medium uppercase tracking-[0.1em] text-[#999890]">
            本次准备保存的内容
          </p>
          <div className="max-h-[300px] overflow-y-auto whitespace-pre-wrap rounded-[8px] border border-[#e2e1dc] bg-[#fafaf8] px-4 py-3 text-body leading-6 text-[#454540]">
            {preview.content}
          </div>

          <p className="mb-2 mt-5 text-control font-medium uppercase tracking-[0.1em] text-[#999890]">
            相比当前方案的主要变化
          </p>
          <div className="rounded-[8px] bg-[#f3f6f4] px-4 py-3 text-body leading-5 text-[#53675c]">
            {preview.changeSummary}
          </div>

          {error && (
            <div role="alert" className="mt-4 rounded-md border border-[#eadfd8] bg-[#fbf5f1] px-3 py-2 text-body text-[#895c49]">
              {error}
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[#e8e7e2] px-5 py-4">
          <button
            type="button"
            disabled={isSaving}
            onClick={onCancel}
            className="h-8 rounded-md border border-[#deddd7] px-3 text-body font-medium text-[#62615b] hover:bg-[#f5f5f2] disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            disabled={isSaving}
            aria-busy={isSaving}
            onClick={onConfirm}
            className="h-8 rounded-md bg-[#252522] px-3.5 text-body font-medium text-white hover:bg-[#11110f] disabled:opacity-50"
          >
            {isSaving ? "正在保存…" : "确认保存"}
          </button>
        </footer>
      </section>
    </div>
  );
}
