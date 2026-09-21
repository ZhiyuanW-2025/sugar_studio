import { isUuid } from "../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return fail("项目参数无效。", 400);

  try {
    const { supabase } = await requireProjectMember(projectId);
    const [knowledgeScopesResult, driveScopesResult] = await Promise.all([
      supabase.from("feishu_sync_scopes")
        .select("id,root_node_token,source_url,display_name,last_incremental_sync_at,last_full_sync_at,last_sync_status,last_sync_error,sync_frequency")
        .eq("project_id", projectId).eq("scope_type", "project").eq("enabled", true)
        .order("created_at", { ascending: true }),
      supabase.from("feishu_drive_scopes")
        .select("id,folder_token,source_url,display_name,last_sync_at,last_sync_status,last_sync_error,sync_frequency")
        .eq("project_id", projectId).eq("enabled", true)
        .order("created_at", { ascending: true }),
    ]);
    if (knowledgeScopesResult.error || driveScopesResult.error) return fail("暂时无法读取飞书连接。", 500);

    const knowledgeScopes = knowledgeScopesResult.data ?? [];
    const driveScopes = driveScopesResult.data ?? [];
    const knowledgeScopeIds = knowledgeScopes.map((item) => item.id);
    const driveScopeIds = driveScopes.map((item) => item.id);

    const [wikiResult, driveResult] = await Promise.all([
      knowledgeScopeIds.length
        ? supabase.from("feishu_knowledge_documents")
          .select("id,sync_scope_id,node_token,parent_node_token,obj_type,title,source_url,external_updated_at,sync_status,sync_error,project_file_id")
          .eq("project_id", projectId).in("sync_scope_id", knowledgeScopeIds)
          .neq("sync_status", "deleted").order("title", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      driveScopeIds.length
        ? supabase.from("feishu_drive_items")
          .select("id,scope_id,file_token,parent_file_token,item_type,file_name,source_url,path_text,source_updated_at,content_summary,index_status,index_error")
          .eq("project_id", projectId).in("scope_id", driveScopeIds)
          .order("path_text", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (wikiResult.error || driveResult.error) return fail("暂时无法读取项目材料目录。", 500);

    const wikiRows = wikiResult.data ?? [];
    const projectFileIds = wikiRows.map((item) => item.project_file_id).filter(Boolean) as string[];
    const summaries = new Map<string, { user_description: string; agent_summary: string; status: string }>();
    if (projectFileIds.length) {
      const { data } = await supabase.from("knowledge_documents")
        .select("project_file_id,user_description,agent_summary,status")
        .in("project_file_id", projectFileIds);
      for (const item of data ?? []) if (item.project_file_id) summaries.set(item.project_file_id, item);
    }

    const syncDates = [
      ...knowledgeScopes.flatMap((item) => [item.last_incremental_sync_at, item.last_full_sync_at]),
      ...driveScopes.map((item) => item.last_sync_at),
    ].filter(Boolean) as string[];
    const lastSyncedAt = syncDates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

    return Response.json({
      lastSyncedAt,
      knowledgeScopes,
      driveScopes,
      knowledgeItems: wikiRows.map((item) => ({
        ...item,
        summary: item.project_file_id ? summaries.get(item.project_file_id)?.agent_summary || summaries.get(item.project_file_id)?.user_description || "" : "",
        index_status: item.project_file_id ? summaries.get(item.project_file_id)?.status || item.sync_status : item.sync_status,
      })),
      driveItems: driveResult.data ?? [],
    }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    return fail("暂时无法读取项目材料。", 500);
  }
}
