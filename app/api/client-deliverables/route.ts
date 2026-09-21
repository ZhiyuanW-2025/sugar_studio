import { loadClientDeliverables } from "../../../lib/client-deliverables/data";
import { isClientDeliverableType } from "../../../lib/client-deliverables/types";
import { isUuid } from "../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function accessError(error: unknown) {
  if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
  return Response.json({ error: "客户材料操作失败，请稍后重试。" }, { status: 500, headers });
}

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return Response.json({ error: "项目参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(projectId);
    return Response.json({ deliverables: await loadClientDeliverables(supabase, projectId) }, { headers });
  } catch (error) { return accessError(error); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const deliverableType = body?.deliverableType;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const audience = typeof body?.audience === "string" ? body.audience.trim() : "";
  const purpose = typeof body?.purpose === "string" ? body.purpose.trim() : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const sourceThreadId = isUuid(body?.sourceThreadId) ? body.sourceThreadId : null;
  if (!isUuid(projectId) || !isClientDeliverableType(deliverableType) || !title || !content || title.length > 240 || content.length > 100_000) {
    return Response.json({ error: "客户材料参数无效。" }, { status: 400, headers });
  }
  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data, error } = await supabase.rpc("create_client_deliverable", {
      p_project_id: projectId, p_deliverable_type: deliverableType, p_title: title,
      p_audience: audience, p_purpose: purpose, p_content: content, p_source_thread_id: sourceThreadId,
    });
    if (error || !data) return Response.json({ error: "客户材料保存失败。" }, { status: 500, headers });
    return Response.json({ created: true, deliverable: data }, { status: 201, headers });
  } catch (error) { return accessError(error); }
}
