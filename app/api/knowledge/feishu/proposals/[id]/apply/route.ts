import { WorkspaceAccessError, requireWorkspaceMember } from "../../../../../../../lib/knowledge/access";
import { applyFeishuChangeProposal, FeishuProposalError } from "../../../../../../../lib/feishu/proposal-service";
import { isUuid } from "../../../../../../../lib/model-config/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireWorkspaceMember();
    const { id } = await context.params;
    if (!isUuid(id)) return Response.json({ error: "飞书知识变更参数无效。" }, { status: 400, headers });
    const result = await applyFeishuChangeProposal({ proposalId: id, appliedBy: user.id });
    return Response.json({ applied: true, ...result }, { headers });
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status
      : error instanceof FeishuProposalError ? error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 502
        : 500;
    const message = error instanceof WorkspaceAccessError || error instanceof FeishuProposalError
      ? error.message
      : "飞书知识写入失败，请稍后重试。";
    return Response.json({ error: message }, { status, headers });
  }
}
