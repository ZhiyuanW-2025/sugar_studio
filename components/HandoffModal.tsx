import { useEffect, useRef, useState } from "react";
import { agentMeta } from "./mockData";
import type { AgentId } from "./types";

type HandoffModalProps = {
  target: "coder" | "designer";
  initialContent: string;
  onCancel: () => void;
  onConfirm: (content: string) => void;
};

export function HandoffModal({ target, initialContent, onCancel, onConfirm }: HandoffModalProps) {
  const [content, setContent] = useState(initialContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const targetMeta = agentMeta[target];

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#161613]/25 px-6 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="handoff-title" className="panel-in flex max-h-[88vh] w-full max-w-[620px] flex-col overflow-hidden rounded-[12px] border border-[#d9d8d2] bg-white shadow-[0_30px_90px_rgba(20,20,16,0.22)]">
        <header className="flex shrink-0 items-start border-b border-[#e8e7e2] px-5 py-4">
          <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-[8px] bg-[#edf4f0] text-[11px] font-semibold text-[#416253]">{targetMeta.initials}</span>
          <div className="ml-3">
            <h2 id="handoff-title" className="text-[15px] font-semibold tracking-[-0.02em] text-[#292925]">发送给{targetMeta.name}</h2>
            <p className="mt-1 text-[11px] text-[#8e8d85]">确认后，任务会直接出现在对方的工作面板中</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭" className="ml-auto grid h-7 w-7 place-items-center rounded-md text-[18px] text-[#8c8b83] hover:bg-[#f3f3f0]">×</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="handoff-content" className="text-[10px] font-medium uppercase tracking-[0.1em] text-[#88877f]">任务内容</label>
            <span className="text-[10px] text-[#aaa9a1]">由策划上下文自动整理</span>
          </div>
          <textarea
            ref={textareaRef}
            id="handoff-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="subtle-scrollbar h-[380px] w-full resize-none rounded-[8px] border border-[#dfded8] bg-[#fbfbf9] px-4 py-3.5 font-mono text-[11px] leading-[1.75] text-[#44443f] outline-none focus:border-[#aaa9a1] focus:bg-white focus:shadow-[0_0_0_3px_rgba(20,20,18,0.035)]"
          />
        </div>

        <footer className="flex shrink-0 items-center border-t border-[#e8e7e2] bg-[#fbfbf9] px-5 py-3.5">
          <div className="flex items-center gap-1.5 text-[10px] text-[#999890]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#50806d]" />
            发送前可自由修改
          </div>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onCancel} className="h-8 rounded-md px-3 text-[11px] font-medium text-[#696861] hover:bg-[#efefeb]">取消</button>
            <button type="button" onClick={() => textareaRef.current?.focus()} className="h-8 rounded-md border border-[#deddd7] bg-white px-3 text-[11px] font-medium text-[#55554f] hover:bg-[#f5f5f2]">编辑内容</button>
            <button type="button" disabled={!content.trim()} onClick={() => onConfirm(content)} className="h-8 rounded-md bg-[#252522] px-3.5 text-[11px] font-medium text-white hover:bg-[#11110f] disabled:opacity-40">确认发送</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
