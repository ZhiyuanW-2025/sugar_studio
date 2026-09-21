import { WorkspaceAccessError, requireWorkspaceMember } from "../../../../../../lib/knowledge/access";
import { cancelFeishuChangeProposal, FeishuProposalError } from "../../../../../../lib/feishu/proposal-service";
import { isUuid } from "../../../../../../lib/model-config/http";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireWorkspaceMember();
    const { id } = await context.params;
    if (!isUuid(id)) return Response.json({ error: "飞书知识变更参数无效。" }, { status: 400, headers });
    await cancelFeishuChangeProposal(id);
    return Response.json({ cancelled: true }, { headers });
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status
      : error instanceof FeishuProposalError ? 409
        : 500;
    const message = error instanceof WorkspaceAccessError || error instanceof FeishuProposalError
      ? error.message
      : "暂时无法取消飞书知识变更。";
    return Response.json({ error: message }, { status, headers });
  }
}
