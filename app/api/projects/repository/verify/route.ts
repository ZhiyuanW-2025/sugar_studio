import { getLocalGitProvider } from "../../../../../lib/git/local-git-provider";
import { GitProviderError } from "../../../../../lib/git/provider";
import { mapRepositoryRow } from "../../../../../lib/git/repository-service";
import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number, code?: string, details?: unknown) =>
  Response.json({ error, code, details }, { status, headers });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  if (!isUuid(projectId)) return errorResponse("项目参数无效。", 400);
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const [{ data, error }, { data: workspace, error: workspaceError }] = await Promise.all([
      supabase.from("project_repositories").select("*").eq("project_id", projectId).maybeSingle(),
      supabase.from("user_project_repository_workspaces").select("*").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
    ]);
    if (error || workspaceError || !data || !workspace) return errorResponse("请先配置你在当前设备使用的本地仓库路径。", 409);
    const repository = mapRepositoryRow(data, workspace);
    if (repository.provider !== "local_git") return errorResponse("当前阶段只支持本地 Git 仓库。", 422);
    const status = await getLocalGitProvider(user.id).getRepositoryStatus(repository);
    return Response.json({ verified: true, status }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    if (error instanceof GitProviderError) return errorResponse(error.message, 422, error.code, error.details);
    return errorResponse("暂时无法读取本地 Git 仓库。", 500);
  }
}
