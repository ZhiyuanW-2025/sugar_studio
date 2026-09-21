import { WorkspaceAccessError, requireWorkspaceMember } from "../../../../../../../lib/knowledge/access";
import { isUuid } from "../../../../../../../lib/model-config/http";
import { FeishuProposalError, resolveFeishuMergeConflict } from "../../../../../../../lib/feishu/proposal-service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireWorkspaceMember();
    const { id } = await context.params;
    if (!isUuid(id)) return Response.json({ error: "冲突参数无效。" }, { status: 400, headers });
    const { data: visible } = await supabase.from("feishu_merge_conflicts").select("id").eq("id", id).eq("status", "pending").maybeSingle();
    if (!visible) return Response.json({ error: "没有找到可处理的飞书冲突。" }, { status: 404, headers });
    const body = await request.json().catch(() => null);
    const resolution = ["agent", "feishu", "custom"].includes(body?.resolution) ? body.resolution as "agent" | "feishu" | "custom" : null;
    if (!resolution) return Response.json({ error: "请选择要保留的版本。" }, { status: 400, headers });
    const result = await resolveFeishuMergeConflict({
      conflictId: id,
      resolvedBy: user.id,
      resolution,
      customContent: typeof body?.customContent === "string" ? body.customContent : null,
    });
    return Response.json({ resolved: true, ...result }, { headers });
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status
      : error instanceof FeishuProposalError ? error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400
        : 500;
    const message = error instanceof WorkspaceAccessError || error instanceof FeishuProposalError
      ? error.message : "暂时无法处理飞书内容冲突。";
    return Response.json({ error: message }, { status, headers });
  }
}
