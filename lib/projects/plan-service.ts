import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type PlanSavePreview = {
  sourceThreadId: string;
  content: string;
  currentPlanSummary: string;
  changeSummary: string;
  nextVersion: number;
};

type ThreadRow = { id: string };
type MessageRow = { content: string };
type SnapshotRow = { current_plan_summary: string };
type ArtifactRow = { id: string };
type VersionRow = { version: number };

function summarizeChanges(currentPlan: string, nextPlan: string) {
  if (!currentPlan.trim()) return "首次建立正式策划方案。";
  if (currentPlan.trim() === nextPlan.trim()) {
    return "内容与当前方案一致；确认后仍会形成一个新的正式版本。";
  }

  const currentLines = new Set(
    currentPlan.split("\n").map((line) => line.trim()).filter(Boolean),
  );
  const changedLines = nextPlan
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !currentLines.has(line))
    .slice(0, 3);

  if (changedLines.length === 0) {
    return "更新当前正式方案的表达与结构，旧版本将完整保留。";
  }

  return `主要新增或调整：${changedLines.join("；")}`;
}

export async function preparePlanSavePreview(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<PlanSavePreview | null> {
  const { data: thread, error: threadError } = await supabase
    .from("agent_threads")
    .select("id")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("agent_type", "planning")
    .maybeSingle();

  if (threadError) throw new Error("Planning thread lookup failed.");
  if (!thread) return null;

  const threadRow = thread as ThreadRow;
  const [messageResult, snapshotResult, artifactResult] = await Promise.all([
    supabase
      .from("messages")
      .select("content")
      .eq("thread_id", threadRow.id)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("project_snapshots")
      .select("current_plan_summary")
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("artifacts")
      .select("id")
      .eq("project_id", projectId)
      .eq("artifact_type", "planning_plan")
      .maybeSingle(),
  ]);

  if (messageResult.error || snapshotResult.error || artifactResult.error) {
    throw new Error("Plan preview lookup failed.");
  }
  if (!messageResult.data) return null;

  const content = (messageResult.data as MessageRow).content.trim();
  const currentPlanSummary =
    ((snapshotResult.data as SnapshotRow | null)?.current_plan_summary ?? "").trim();
  let currentVersion = 0;

  if (artifactResult.data) {
    const { data: version, error: versionError } = await supabase
      .from("artifact_versions")
      .select("version")
      .eq("artifact_id", (artifactResult.data as ArtifactRow).id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionError) throw new Error("Plan version lookup failed.");
    currentVersion = (version as VersionRow | null)?.version ?? 0;
  }

  return {
    sourceThreadId: threadRow.id,
    content,
    currentPlanSummary,
    changeSummary: summarizeChanges(currentPlanSummary, content),
    nextVersion: currentVersion + 1,
  };
}
