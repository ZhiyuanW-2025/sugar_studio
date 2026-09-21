import { getLocalGitProvider } from "../../../../lib/git/local-git-provider";
import { GitProviderError } from "../../../../lib/git/provider";
import { mapRepositoryRow, repositoryInputSchema } from "../../../../lib/git/repository-service";
import { isUuid } from "../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number, code?: string, details?: unknown) =>
  Response.json({ error, code, details }, { status, headers });

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return errorResponse("项目参数无效。", 400);
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const [{ data, error }, { data: workspace, error: workspaceError }] = await Promise.all([
      supabase.from("project_repositories").select("*").eq("project_id", projectId).maybeSingle(),
      supabase.from("user_project_repository_workspaces").select("*").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
    ]);
    if (error || workspaceError) return errorResponse("暂时无法读取项目仓库配置。", 500);
    return Response.json({
      repository: data && workspace ? mapRepositoryRow(data, workspace) : null,
      sharedRemoteUrl: data?.remote_url || null,
      localWorkspaceConfigured: Boolean(workspace),
    }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    return errorResponse("暂时无法读取项目仓库配置。", 500);
  }
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const parsed = repositoryInputSchema.safeParse(body?.repository);
  if (!isUuid(projectId) || !parsed.success) return errorResponse("本地仓库配置无效。", 400);
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const candidate = {
      id: "pending",
      projectId,
      provider: "local_git" as const,
      runnerDeviceId: parsed.data.runnerDeviceId,
      localRepositoryPath: parsed.data.localRepositoryPath,
      remoteName: parsed.data.remoteName,
      remoteUrl: parsed.data.remoteUrl || null,
      currentBranch: "",
      defaultBranch: null,
      createdAt: "",
      updatedAt: "",
    };
    const status = await getLocalGitProvider(user.id, parsed.data.runnerDeviceId).getRepositoryStatus(candidate);
    if (status.availableRemotes.length > 0 && !status.remoteUrl) {
      return errorResponse(
        `没有找到 Git Remote“${parsed.data.remoteName}”。当前可用 Remote：${status.availableRemotes.join("、")}。Remote 名称不是分支名，当前分支会自动读取。`,
        422,
        "not_found",
      );
    }
    const { data, error } = await supabase.rpc("save_user_project_repository_workspace", {
      p_project_id: projectId,
      p_runner_device_id: parsed.data.runnerDeviceId,
      p_local_repository_path: status.localRepositoryPath,
      p_remote_name: status.remoteName,
      p_remote_url: parsed.data.remoteUrl || status.remoteUrl || "",
      p_current_branch: status.currentBranch,
      p_default_branch: status.defaultBranch || "",
    });
    if (error || !data) return errorResponse("仓库验证成功，但暂时无法保存绑定。", 500);
    return Response.json({ repository: mapRepositoryRow(data, {
      runner_device_id: parsed.data.runnerDeviceId,
      local_repository_path: status.localRepositoryPath,
      remote_name: status.remoteName,
      current_branch: status.currentBranch,
    }), status, verified: true }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    if (error instanceof GitProviderError) return errorResponse(error.message, 422, error.code, error.details);
    return errorResponse("暂时无法验证或保存本地 Git 仓库。", 500);
  }
}

export async function DELETE(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return errorResponse("项目参数无效。", 400);
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { error } = await supabase.from("user_project_repository_workspaces")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", user.id);
    if (error) return errorResponse("暂时无法解除本地仓库绑定。", 500);
    return Response.json({ unbound: true }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    return errorResponse("暂时无法解除本地仓库绑定。", 500);
  }
}
