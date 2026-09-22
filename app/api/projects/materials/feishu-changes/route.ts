import { confirmPendingProjectFeishuChanges } from "../../../../../lib/feishu/event-service";
import { indexKnowledgeDocument } from "../../../../../lib/knowledge/service";
import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = isUuid(body?.projectId) ? body.projectId as string : null;
  if (!projectId) return Response.json({ error: "项目参数无效。" }, { status: 400, headers });

  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const result = await confirmPendingProjectFeishuChanges({ projectId, requestedBy: user.id });
    let indexed = 0;
    let indexFailed = 0;
    for (const documentId of result.documentIds) {
      try {
        await indexKnowledgeDocument({ supabase, userId: user.id, documentId });
        indexed += 1;
      } catch {
        indexFailed += 1;
      }
    }
    return Response.json({ ...result, indexed, indexFailed }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    return Response.json({ error: "飞书资料同步失败，请检查飞书权限后重试。" }, { status: 500, headers });
  }
}
