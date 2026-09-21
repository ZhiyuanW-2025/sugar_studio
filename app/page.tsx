import { LoginPage } from "../components/LoginPage";
import { NoProjectAccess } from "../components/NoProjectAccess";
import { SugarStudioApp } from "../components/SugarStudioApp";
import type { Project } from "../components/types";
import { createClient } from "../lib/supabase/server";
import { redirect } from "next/navigation";
import { orderProjectsByRecentConversation } from "../lib/projects/recent-order";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <LoginPage />;
  }

  const [{ data: profile }, { data: memberships }, { data: modelConfigs }] = await Promise.all([
    supabase.from("profiles").select("display_name, avatar_url, model_onboarding_completed_at").eq("id", user.id).maybeSingle(),
    supabase
      .from("project_members")
      .select("project_id, role")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase.from("user_model_configs").select("id").eq("user_id", user.id).limit(1),
  ]);

  const displayName =
    profile?.display_name ||
    (typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : null) ||
    user.email?.split("@")[0] ||
    "Sugar User";
  const email = user.email ?? "";

  if (!profile?.model_onboarding_completed_at) {
    redirect("/onboarding/model");
  }

  if (!memberships?.length) {
    return <NoProjectAccess displayName={displayName} email={email} />;
  }

  const projectIds = memberships.map((membership) => membership.project_id);
  const [{ data: projectRows }, { data: snapshotRows }, { data: threadRows }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, description, status, project_kind, created_at, updated_at")
      .in("id", projectIds),
    supabase
      .from("project_snapshots")
      .select("project_id, summary, current_plan_summary, current_stage")
      .in("project_id", projectIds),
    supabase
      .from("agent_threads")
      .select("project_id, updated_at")
      .eq("user_id", user.id)
      .in("project_id", projectIds),
  ]);

  const membershipByProject = new Map(memberships.map((membership) => [membership.project_id, membership.role]));
  const snapshotByProject = new Map((snapshotRows ?? []).map((snapshot) => [snapshot.project_id, snapshot]));
  const latestConversationByProject = new Map<string, string>();
  for (const thread of threadRows ?? []) {
    const current = latestConversationByProject.get(thread.project_id);
    if (!current || Date.parse(thread.updated_at) > Date.parse(current)) {
      latestConversationByProject.set(thread.project_id, thread.updated_at);
    }
  }
  const projects: Project[] = orderProjectsByRecentConversation((projectRows ?? [])
    .filter((project) => project.project_kind !== "inbox")
    .map((project) => {
      const snapshot = snapshotByProject.get(project.id);
      const currentStage = snapshot?.current_stage || "筹备中";
      const summary = snapshot?.summary || "";
      const currentPlanSummary = snapshot?.current_plan_summary || "";
      return {
        id: project.id,
        name: project.name,
        short: Array.from(project.name.trim()).slice(0, 1).join("") || "项",
        description: project.description,
        status: project.status,
        kind: project.project_kind === "workspace_materials" ? "workspace_materials" : "standard",
        role: membershipByProject.get(project.id) === "project_lead" ? "project_lead" : "member",
        currentStage,
        summary,
        currentPlanSummary,
        focus: currentPlanSummary || summary || project.description || "开始与制作人小花推进项目",
        module: "当前方案",
        knowledge: [
          currentStage ? `当前项目阶段：${currentStage}` : "",
          summary,
          currentPlanSummary,
        ].filter(Boolean),
        lastConversationAt: latestConversationByProject.get(project.id) ?? null,
      } satisfies Project;
    }));

  if (!projects.length) {
    return <NoProjectAccess displayName={displayName} email={email} />;
  }

  return (
    <SugarStudioApp
      currentUser={{
        displayName,
        email,
        avatarUrl: profile?.avatar_url ?? null,
      }}
      initialProjects={projects}
      hasModelConfig={(modelConfigs?.length ?? 0) > 0}
    />
  );
}
