import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ error: "项目参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(id);
    const [{ data: project, error: projectError }, { data: snapshot, error: snapshotError }, { data: artifact, error: artifactError }] = await Promise.all([
      supabase.from("projects").select("id, name, description, status, updated_at").eq("id", id).single(),
      supabase.from("project_snapshots").select("id, summary, current_plan_summary, current_stage, current_plan_version_id, updated_at").eq("project_id", id).maybeSingle(),
      supabase.from("artifacts").select("id, title, current_version_id, updated_at").eq("project_id", id).eq("artifact_type", "planning_plan").maybeSingle(),
    ]);
    if (projectError || snapshotError || artifactError || !project) return Response.json({ error: "项目大脑加载失败。" }, { status: 500, headers });

    let versions: Array<Record<string, unknown>> = [];
    if (artifact) {
      const { data, error } = await supabase.from("artifact_versions")
        .select("id, version, content, change_summary, created_by, source_thread_id, created_at")
        .eq("artifact_id", artifact.id).order("version", { ascending: false });
      if (error) return Response.json({ error: "方案版本加载失败。" }, { status: 500, headers });
      const creatorIds = [...new Set((data ?? []).map((version) => version.created_by).filter(Boolean))];
      const { data: profiles } = creatorIds.length
        ? await supabase.from("profiles").select("id, display_name").in("id", creatorIds)
        : { data: [] };
      const creatorNames = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]));
      versions = (data ?? []).map((version) => ({
        id: version.id,
        version: version.version,
        content: version.content,
        changeSummary: version.change_summary,
        createdBy: version.created_by,
        creatorName: version.created_by ? creatorNames.get(version.created_by) || "项目成员" : "已删除用户",
        sourceThreadId: version.source_thread_id,
        createdAt: version.created_at,
        isCurrent: artifact.current_version_id === version.id,
      }));
    }

    return Response.json({
      project: { id: project.id, name: project.name, description: project.description, status: project.status, updatedAt: project.updated_at },
      snapshot: {
        summary: snapshot?.summary || "",
        currentPlanSummary: snapshot?.current_plan_summary || "",
        currentStage: snapshot?.current_stage || "",
        currentPlanVersionId: snapshot?.current_plan_version_id || null,
        updatedAt: snapshot?.updated_at || project.updated_at,
      },
      artifact: artifact ? { id: artifact.id, title: artifact.title, currentVersionId: artifact.current_version_id } : null,
      versions,
    }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "项目大脑加载失败。" }, { status: 500, headers });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const summary = typeof body?.summary === "string" ? body.summary.trim() : null;
  const currentStage = typeof body?.currentStage === "string" ? body.currentStage.trim() : null;
  if (!isUuid(id) || summary === null || currentStage === null || summary.length > 12000 || currentStage.length > 200) {
    return Response.json({ error: "项目概况参数无效。" }, { status: 400, headers });
  }
  try {
    const { supabase } = await requireProjectMember(id);
    const { data, error } = await supabase.rpc("update_project_brain_context", {
      p_project_id: id,
      p_summary: summary,
      p_current_stage: currentStage,
    });
    if (error || !data) return Response.json({ error: "项目概况更新失败。" }, { status: 500, headers });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "项目概况更新失败。" }, { status: 500, headers });
  }
}
