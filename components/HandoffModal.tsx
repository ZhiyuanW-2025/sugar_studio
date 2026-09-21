import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  HandoffBrief,
  TechnicalBrief,
  VisualBrief,
} from "../lib/handoffs/briefs";
import { agentMeta } from "./mockData";
import { AgentAvatar } from "./AgentAvatar";

type HandoffModalProps = {
  target: "coder" | "designer";
  initialBrief: HandoffBrief;
  isSending: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (brief: HandoffBrief) => void;
};

const lines = (value: string[]) => value.join("\n");
const parseLines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);

function Field({
  label,
  value,
  onChange,
  multiline = true,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-control font-medium text-[#74736c]">{label}</span>
      {multiline ? (
        <textarea
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={value.includes("\n") ? 4 : 3}
          className="subtle-scrollbar w-full resize-y rounded-[7px] border border-[#dfded8] bg-[#fbfbf9] px-3 py-2.5 text-body leading-[1.65] text-[#44443f] outline-none focus:border-[#aaa9a1] focus:bg-white"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-[7px] border border-[#dfded8] bg-[#fbfbf9] px-3 text-body text-[#44443f] outline-none focus:border-[#aaa9a1] focus:bg-white"
        />
      )}
    </label>
  );
}

export function HandoffModal({ target, initialBrief, isSending, error, onCancel, onConfirm }: HandoffModalProps) {
  const [brief, setBrief] = useState(initialBrief);
  const firstTextareaRef = useRef<HTMLTextAreaElement>(null);
  const targetMeta = agentMeta[target];

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSending) onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isSending, onCancel]);

  const update = (field: string, value: string | string[]) => {
    setBrief((current) => ({ ...current, [field]: value }) as HandoffBrief);
  };
  const technical = brief as TechnicalBrief;
  const visual = brief as VisualBrief;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#161613]/25 px-6 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="handoff-title" className="panel-in flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[12px] border border-[#d9d8d2] bg-white shadow-[0_30px_90px_rgba(20,20,16,0.22)]">
        <header className="flex shrink-0 items-start border-b border-[#e8e7e2] px-5 py-4">
          <AgentAvatar agentId={target} initials={targetMeta.initials} className="mt-0.5 grid h-8 w-8 place-items-center rounded-[8px] bg-[#edf4f0] text-body font-semibold text-[#416253]" />
          <div className="ml-3">
            <h2 id="handoff-title" className="text-section-title font-semibold tracking-[-0.02em] text-[#292925]">发送给{targetMeta.name}</h2>
            <p className="mt-1 text-body text-[#8e8d85]">{target === "coder" ? "工程任务 · 确认后牛牛会开始执行" : "Visual Brief · 确认后才会发送"}</p>
          </div>
          <button type="button" disabled={isSending} onClick={onCancel} aria-label="关闭" className="ml-auto grid h-7 w-7 place-items-center rounded-md text-[18px] text-[#8c8b83] hover:bg-[#f3f3f0] disabled:opacity-40">×</button>
        </header>

        <div className="subtle-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <Field label="任务标题" value={brief.title} multiline={false} onChange={(value) => update("title", value)} />
          <Field label="要完成什么" value={brief.goal} inputRef={firstTextareaRef} onChange={(value) => update("goal", value)} />

          {target === "coder" ? (
            <>
              <Field label="任务背景" value={technical.background} onChange={(value) => update("background", value)} />
              <Field label="具体要求（每行一项）" value={lines(technical.requirements)} onChange={(value) => update("requirements", parseLines(value))} />
              <Field label="限制条件（每行一项）" value={lines(technical.constraints)} onChange={(value) => update("constraints", parseLines(value))} />
              <Field label="不要修改（每行一项）" value={lines(technical.unchanged_scope)} onChange={(value) => update("unchanged_scope", parseLines(value))} />
              <Field label="怎样算完成（每行一项）" value={lines(technical.acceptance_criteria)} onChange={(value) => update("acceptance_criteria", parseLines(value))} />
            </>
          ) : (
            <>
              <Field label="使用场景 · usage" value={visual.usage} onChange={(value) => update("usage", value)} />
              <Field label="内容要求 · content_requirements（每行一项）" value={lines(visual.content_requirements)} onChange={(value) => update("content_requirements", parseLines(value))} />
              <Field label="视觉方向 · visual_direction（每行一项）" value={lines(visual.visual_direction)} onChange={(value) => update("visual_direction", parseLines(value))} />
              <Field label="必须包含 · required_elements（每行一项）" value={lines(visual.required_elements)} onChange={(value) => update("required_elements", parseLines(value))} />
              <Field label="禁止包含 · forbidden_elements（每行一项）" value={lines(visual.forbidden_elements)} onChange={(value) => update("forbidden_elements", parseLines(value))} />
              <Field label="尺寸或媒介 · size_or_medium" value={visual.size_or_medium} onChange={(value) => update("size_or_medium", value)} />
              <Field label="参考资料 · references（每行一项）" value={lines(visual.references)} onChange={(value) => update("references", parseLines(value))} />
            </>
          )}

          <div className="grid grid-cols-2 gap-3 rounded-[7px] border border-[#e7e6e1] bg-[#f7f7f4] px-3.5 py-3 text-control text-[#77766f]">
            <div><span className="block text-[#aaa9a1]">相关项目</span><span className="mt-1 block">{brief.related_project}</span></div>
            <div><span className="block text-[#aaa9a1]">来源正式方案版本</span><span className="mt-1 block font-mono">{brief.source_plan_version ?? "未关联"}</span></div>
          </div>
          {error && <p role="alert" className="text-body text-[#98584b]">{error}</p>}
        </div>

        <footer className="flex shrink-0 items-center border-t border-[#e8e7e2] bg-[#fbfbf9] px-5 py-3.5">
          <div className="flex items-center gap-1.5 text-control text-[#999890]"><span className="h-1.5 w-1.5 rounded-full bg-[#50806d]" />发送前可逐项修改</div>
          <div className="ml-auto flex gap-2">
            <button type="button" disabled={isSending} onClick={onCancel} className="h-8 rounded-md px-3 text-body font-medium text-[#696861] hover:bg-[#efefeb] disabled:opacity-40">取消</button>
            <button type="button" disabled={isSending} onClick={() => firstTextareaRef.current?.focus()} className="h-8 rounded-md border border-[#deddd7] bg-white px-3 text-body font-medium text-[#55554f] hover:bg-[#f5f5f2] disabled:opacity-40">编辑内容</button>
            <button type="button" aria-busy={isSending} disabled={isSending || !brief.title.trim() || !brief.goal.trim()} onClick={() => onConfirm(brief)} className="h-8 rounded-md bg-[#252522] px-3.5 text-body font-medium text-white hover:bg-[#11110f] disabled:opacity-40">{isSending ? (target === "coder" ? "正在交给牛牛…" : "正在发送…") : (target === "coder" ? "确认并开始修改" : "确认发送")}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
