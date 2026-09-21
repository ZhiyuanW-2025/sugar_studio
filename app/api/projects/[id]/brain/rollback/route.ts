import { isUuid } from "../../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const versionId = body?.versionId;
  if (!isUuid(id) || !isUuid(versionId)) return Response.json({ error: "方案版本参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(id);
    const { data, error } = await supabase.rpc("rollback_current_plan", { p_project_id: id, p_target_version_id: versionId });
    if (error || !Array.isArray(data) || !data[0]) return Response.json({ error: "方案回滚失败。" }, { status: 400, headers });
    return Response.json({ ok: true, version: data[0] }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "方案回滚失败。" }, { status: 500, headers });
  }
}
