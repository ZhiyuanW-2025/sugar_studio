"use client";

import { useEffect, useState } from "react";

type Feedback = {
  kind: "loading" | "success" | "error";
  label: string;
} | null;

const CLICK_WINDOW_MS = 1_200;
const COMPLETION_VISIBLE_MS = 1_000;

function actionLabel(target: Element) {
  const explicit = target.getAttribute("aria-label") || target.getAttribute("title");
  const text = explicit || target.textContent || "";
  return text.replace(/\s+/g, " ").trim().slice(0, 24);
}

/**
 * Gives every control an immediate pressed state and tracks requests that were
 * initiated by a user action. Individual features still own their detailed
 * progress and error UI; this is the consistent, workspace-wide safety net.
 */
export function InteractionFeedback({ children }: { children: React.ReactNode }) {
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    let actionWindowEndsAt = 0;
    let activeRequests = 0;
    let actionFailed = false;
    let currentLabel = "";
    let completionTimer: number | undefined;
    const originalFetch = window.fetch;

    const update = (next: Feedback) => {
      setFeedback(next);
    };

    const markInteraction = (event: Event) => {
      const eventTarget = event.type === "submit" && (event as SubmitEvent).submitter instanceof Element
        ? (event as SubmitEvent).submitter
        : event.target;
      const source = eventTarget instanceof Element
        ? eventTarget.closest("button, a, label, [role='button']")
        : null;
      if (!source || source.matches("button:disabled, [aria-disabled='true']")) return;
      actionWindowEndsAt = performance.now() + CLICK_WINDOW_MS;
      currentLabel = actionLabel(source);
      source.setAttribute("data-ui-pressed", "true");
      window.setTimeout(() => source.removeAttribute("data-ui-pressed"), 180);
    };

    const wrappedFetch: typeof window.fetch = async (...args) => {
      const belongsToAction = performance.now() <= actionWindowEndsAt || activeRequests > 0;
      if (!belongsToAction) return originalFetch(...args);

      window.clearTimeout(completionTimer);
      activeRequests += 1;
      actionWindowEndsAt = performance.now() + CLICK_WINDOW_MS;
      if (activeRequests === 1) actionFailed = false;
      update({ kind: "loading", label: currentLabel ? `正在处理：${currentLabel}` : "正在处理…" });

      try {
        const response = await originalFetch(...args);
        if (!response.ok) actionFailed = true;
        return response;
      } catch (error) {
        actionFailed = true;
        throw error;
      } finally {
        activeRequests = Math.max(0, activeRequests - 1);
        actionWindowEndsAt = performance.now() + 800;
        if (activeRequests === 0) {
          update(actionFailed
            ? { kind: "error", label: "操作未完成，请查看页面提示" }
            : { kind: "success", label: "操作已完成" });
          completionTimer = window.setTimeout(() => update(null), COMPLETION_VISIBLE_MS);
        }
      }
    };

    document.addEventListener("pointerdown", markInteraction, true);
    document.addEventListener("submit", markInteraction, true);
    window.fetch = wrappedFetch;

    return () => {
      document.removeEventListener("pointerdown", markInteraction, true);
      document.removeEventListener("submit", markInteraction, true);
      window.clearTimeout(completionTimer);
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
    };
  }, []);

  return (
    <>
      {children}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          data-kind={feedback.kind}
          className="global-action-feedback"
        >
          <span className="global-action-feedback__mark" aria-hidden="true" />
          <span>{feedback.label}</span>
        </div>
      )}
      {feedback?.kind === "loading" && <span className="global-action-progress" aria-hidden="true" />}
    </>
  );
}
