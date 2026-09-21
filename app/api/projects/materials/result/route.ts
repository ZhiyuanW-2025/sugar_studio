import { appendFeishuDocumentContent, createFeishuWikiDocument, FeishuApiError } from "../../../../../lib/feishu/client";
import { getFeishuSyncScope } from "../../../../../lib/feishu/scope-service";
import { syncFeishuNodeByToken } from "../../../../../lib/feishu/sync-service";
import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = isUuid(body?.projectId) ? body.projectId as string : null;
  const scopeId = isUuid(body?.scopeId) ? body.scopeId as string : null;
  const parentToken = typeof body?.parentToken === "string" && body.parentToken.trim() ? body.parentToken.trim() : null;
  const title = typeof body?.title === "string" ? body.title.replace(/[\\/\0]/g, "-").trim().slice(0, 180) : "";
  const content = typeof body?.content === "string" ? body.content.trim().slice(0, 80_000) : "";
  if (!projectId || !scopeId || !title || !content) return fail("成果标题、内容或保存位置无效。", 400);
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { data: visible } = await supabase.from("feishu_sync_scopes").select("id,root_node_token")
      .eq("id", scopeId).eq("project_id", projectId).eq("scope_type", "project").eq("enabled", true).maybeSingle();
    if (!visible) return fail("当前项目尚未连接飞书知识库。", 409);
    if (parentToken && parentToken !== visible.root_node_token) {
      const { data: parent } = await supabase.from("feishu_knowledge_documents").select("node_token")
        .eq("sync_scope_id", scopeId).eq("project_id", projectId).eq("node_token", parentToken).maybeSingle();
      if (!parent) return fail("所选知识库目录不属于当前项目。", 403);
    }
    const scope = await getFeishuSyncScope(scopeId);
    const node = await createFeishuWikiDocument(title, { ...scope, rootNodeToken: parentToken ?? scope.rootNodeToken });
    await appendFeishuDocumentContent(node.objToken, content);
    await syncFeishuNodeByToken({ scopeId, nodeToken: node.nodeToken, requestedBy: user.id, force: true }).catch(() => null);
    return Response.json({ saved: true, title: node.title, url: node.url }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    if (error instanceof FeishuApiError) return fail(error.message, error.status === 403 ? 403 : 502);
    return fail("暂时无法把成果保存到飞书知识库。", 500);
  }
}
