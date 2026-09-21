import { isUuid } from "../../../../../../lib/model-config/http";
import { moveProjectFile } from "../../../../../../lib/knowledge/move-project-file";
import { ProjectAccessError, requireProjectMember } from "../../../../../../lib/projects/access";
import { indexKnowledgeDocument, KnowledgeIndexError } from "../../../../../../lib/knowledge/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const targetProjectId = body?.targetProjectId;
  if (!isUuid(id) || !isUuid(targetProjectId)) return fail("归档参数无效。", 400);
  try {
    const { supabase, user } = await requireProjectMember(targetProjectId);
    const { data: source } = await supabase.from("project_files").select("project_id,archive_state,inbox_owner_id").eq("id", id).maybeSingle();
    if (!source || source.inbox_owner_id !== user.id || !["staged", "unarchived"].includes(source.archive_state)) return fail("没有找到该未归档文件。", 404);
    const result = await moveProjectFile({ supabase, fileId: id, sourceProjectId: source.project_id, targetProjectId });
    let indexing: { status: "ready" | "pending" | "unsupported"; error?: string } = { status: result.knowledge?.status === "ready" ? "ready" : "pending" };
    if (result.knowledge?.id && result.knowledge.status !== "ready" && result.knowledge.status !== "unsupported") {
      try {
        await indexKnowledgeDocument({ supabase, userId: user.id, documentId: result.knowledge.id });
        indexing = { status: "ready" };
      } catch (indexError) {
        indexing = { status: indexError instanceof KnowledgeIndexError && indexError.code === "unsupported" ? "unsupported" : "pending", error: indexError instanceof KnowledgeIndexError ? indexError.message : "自动解析暂时失败，系统稍后会重试。" };
      }
    }
    return Response.json({ archived: true, ...result, indexing });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    if (error instanceof Error && error.message === "DUPLICATE") return fail("目标项目已有相同内容的文件。", 409);
    return fail("文件归档失败，请稍后重试。", 500);
  }
}
