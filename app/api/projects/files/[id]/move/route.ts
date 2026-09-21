import { isUuid } from "../../../../../../lib/model-config/http";
import { moveProjectFile } from "../../../../../../lib/knowledge/move-project-file";
import { indexKnowledgeDocument, KnowledgeIndexError } from "../../../../../../lib/knowledge/service";
import { ProjectAccessError, requireProjectMember } from "../../../../../../lib/projects/access";

export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const sourceProjectId = body?.sourceProjectId;
  const targetProjectId = body?.targetProjectId;
  if (!isUuid(id) || !isUuid(sourceProjectId) || !isUuid(targetProjectId)) return Response.json({ error: "移动参数无效。" }, { status: 400 });
  try {
    const source = await requireProjectMember(sourceProjectId);
    await requireProjectMember(targetProjectId);
    const result = await moveProjectFile({ supabase: source.supabase, fileId: id, sourceProjectId, targetProjectId });
    let indexing: { status: "ready" | "pending" | "unsupported"; error?: string } = { status: result.knowledge?.status === "ready" ? "ready" : "pending" };
    if (result.knowledge?.id && result.knowledge.status !== "ready" && result.knowledge.status !== "unsupported") {
      try {
        await indexKnowledgeDocument({ supabase: source.supabase, userId: source.user.id, documentId: result.knowledge.id });
        indexing = { status: "ready" };
      } catch (indexError) {
        indexing = { status: indexError instanceof KnowledgeIndexError && indexError.code === "unsupported" ? "unsupported" : "pending", error: indexError instanceof KnowledgeIndexError ? indexError.message : "自动解析暂时失败，系统稍后会重试。" };
      }
    }
    return Response.json({ moved: true, ...result, indexing });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && error.message === "DUPLICATE") return Response.json({ error: "目标项目已有相同内容的文件。" }, { status: 409 });
    return Response.json({ error: "文件移动失败，请稍后重试。" }, { status: 500 });
  }
}
