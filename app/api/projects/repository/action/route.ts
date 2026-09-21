import { getLocalGitProvider } from "../../../../../lib/git/local-git-provider";
import { GitProviderError, type GitAction } from "../../../../../lib/git/provider";
import { mapRepositoryRow } from "../../../../../lib/git/repository-service";
import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const allowedActions = new Set<GitAction>(["fetch", "pull", "sync", "push", "commit"]);
const errorResponse = (error: string, status: number, code?: string, details?: unknown) =>
  Response.json({ error, code, details }, { status, headers });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const runId = body?.runId;
  const action = body?.action as GitAction;
  if (!isUuid(projectId) || !allowedActions.has(action)) return errorResponse("Git 操作参数无效。", 400);
  if (body?.confirmed !== true) return errorResponse(`${action} 前需要用户明确确认。`, 409, "confirmation_required");
  if (runId != null && !isUuid(runId)) return errorResponse("Coding Run 参数无效。", 400);
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const [{ data, error }, { data: workspace, error: workspaceError }] = await Promise.all([
      supabase.from("project_repositories").select("*").eq("project_id", projectId).maybeSingle(),
      supabase.from("user_project_repository_workspaces").select("*").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
    ]);
    if (error || workspaceError || !data || !workspace) return errorResponse("请先配置你在当前设备使用的本地仓库路径。", 409);
    const repository = mapRepositoryRow(data, workspace);
    if (runId) {
      const { data: run } = await supabase.from("coding_runs").select("id")
        .eq("id", runId).eq("project_id", projectId).maybeSingle();
      if (!run) return errorResponse("对应 Coding Run 不存在，未执行 Git 操作。", 409);
    }
    const provider = getLocalGitProvider(user.id);
    const result = action === "commit"
      ? await provider.commitChanges(repository, String(body?.commitMessage || ""), true)
      : action === "fetch"
        ? await provider.fetchRemote(repository, true)
        : action === "pull"
          ? await provider.pullRemote(repository, true)
          : action === "sync"
            ? await provider.syncDefaultBranch(repository, true)
            : await provider.pushRemote(repository, true);

    const admin = createAdminClient();
    if (runId && (action === "commit" || action === "push")) {
      await admin.from("coding_runs").update(action === "commit" ? {
        commit_sha: result.commitSha,
        head_after: result.status.headCommit,
        branch_after: result.status.currentBranch,
        working_tree_after: result.status.changes,
        push_status: result.status.ahead > 0 ? "pending_confirmation" : "not_requested",
      } : {
        push_status: "succeeded",
        head_after: result.status.headCommit,
        working_tree_after: result.status.changes,
      }).eq("id", runId).eq("project_id", projectId);
    }
    await admin.from("project_activities").insert({
      project_id: projectId,
      user_id: user.id,
      event_type: `git_${action}`,
      actor_type: "user",
      actor: "项目成员",
      summary: action === "commit"
        ? `将当前代码改动保存到本地 Git：${result.status.currentBranch}`
        : action === "push"
          ? `将本地代码修改上传至远端 Git：${result.status.remoteName}/${result.status.currentBranch}`
          : action === "sync"
            ? `将远端主干 ${result.status.remoteName}/${result.status.defaultBranch || "main"} 合并到个人分支 ${result.status.currentBranch}`
          : `完成 Git ${action}：${result.status.remoteName}/${result.status.currentBranch}`,
      related_entity_id: runId || repository.id,
    });
    return Response.json({ result }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    if (error instanceof GitProviderError) {
      const status = error.code === "confirmation_required" ? 409 : error.code === "dirty_worktree" || error.code === "conflict" ? 409 : 422;
      return errorResponse(error.message, status, error.code, error.details);
    }
    return errorResponse("Git 操作失败；未执行自动 reset、stash 或冲突处理。", 500);
  }
}
