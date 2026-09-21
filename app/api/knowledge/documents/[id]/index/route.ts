import { KnowledgeIndexError, indexKnowledgeDocument } from "../../../../../../lib/knowledge/service";
import { isUuid } from "../../../../../../lib/model-config/http";
import { createClient } from "../../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers });

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await getParams(context);
  if (!isUuid(id)) return errorResponse("知识文档参数无效。", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse("请先登录后继续。", 401);

  const { data: document, error } = await supabase
    .from("knowledge_documents")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (error || !document) return errorResponse("没有找到可访问的知识文档。", 404);
  if (document.status === "unsupported") return errorResponse("该文件格式暂不支持建立知识索引。", 422);

  try {
    const result = await indexKnowledgeDocument({ supabase, userId: user.id, documentId: id });
    return Response.json(result, { headers });
  } catch (indexError) {
    if (indexError instanceof KnowledgeIndexError) {
      const status = indexError.code === "forbidden" ? 403
        : indexError.code === "not_found" ? 404
          : indexError.code === "unsupported" ? 422
            : indexError.code === "busy" ? 409
              : indexError.code === "model_missing" ? 409
                : 500;
      return errorResponse(indexError.message, status);
    }
    return errorResponse("知识解析失败，请稍后重试。", 500);
  }
}
