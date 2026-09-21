import { isUuid } from "../../../../../../lib/model-config/http";
import { loadProcurementInquiries, syncProcurementInquiry } from "../../../../../../lib/procurement/inquiries";
import { ProjectAccessError, requireProjectMember } from "../../../../../../lib/projects/access";
import { createAdminClient } from "../../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  if (!isUuid(id) || !isUuid(projectId)) return Response.json({ error: "询盘参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(projectId);
    await syncProcurementInquiry(createAdminClient(), id, projectId);
    const inquiries = await loadProcurementInquiries(supabase, projectId);
    return Response.json({ synced: true, inquiry: inquiries.find((item) => item.id === id) ?? null }, { headers });
  } catch (error) {
    const status = error instanceof ProjectAccessError ? error.status : 502;
    return Response.json({ error: error instanceof ProjectAccessError ? error.message : error instanceof Error ? error.message : "暂时无法同步商家回复。" }, { status, headers });
  }
}
