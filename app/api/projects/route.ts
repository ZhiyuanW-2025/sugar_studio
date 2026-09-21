import { createClient } from "../../../lib/supabase/server";
import { toProjectView } from "../../../lib/projects/view";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (!name || name.length > 120 || description.length > 2000) {
    return Response.json({ error: "请填写有效的项目名称和简介。" }, { status: 400, headers });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "请先登录后继续。" }, { status: 401, headers });

  const { data: created, error } = await supabase.rpc("create_sugar_project", {
    p_name: name,
    p_description: description,
  });
  if (error || !created) {
    return Response.json({ error: "项目创建失败，请稍后重试。" }, { status: 500, headers });
  }

  const { data: snapshot } = await supabase
    .from("project_snapshots")
    .select("summary, current_plan_summary, current_stage")
    .eq("project_id", created.id)
    .maybeSingle();

  return Response.json({ project: toProjectView(created, snapshot, "project_lead") }, { headers });
}
