import { mapCodingRun, recordRunCompleted, recordRunFailed, recordRunStarted } from "../../../../../lib/coding-runs/service";
import { CodingRunnerError } from "../../../../../lib/coding-runs/runner-client";
import { getLocalGitProvider } from "../../../../../lib/git/local-git-provider";
import { GitProviderError } from "../../../../../lib/git/provider";
import { engineeringTaskSchema } from "../../../../../lib/coding-runs/engineering-task";
import { mapRepositoryRow } from "../../../../../lib/git/repository-service";
import { isUuid } from "../../../../../lib/model-config/http";
import { resolveModelConfig } from "../../../../../lib/model-config/service";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";
import { resolveAgentInstructions } from "../../../../../lib/agents/prompt-service";
import { codingAgentInstructions } from "../../../../../lib/agents/coding-agent";
import { runCodingTask } from "../../../../../lib/agents/tools/coding-task-adapter";
import { appendAssistantMessage, getOrCreateAgentThread, setAgentCodexThreadId } from "../../../../../lib/agents/thread-service";
import type { CodingRunView } from "../../../../../lib/coding-runs/types";
import { adaptiveResponseStyleInstructions } from "../../../../../lib/agents/response-style";
import { buildCodingCommitMessage } from "../../../../../lib/coding-runs/commit-message";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number, code?: string, details?: unknown) =>
  Response.json({ error, code, details }, { status, headers });

export async function POST(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const requestStartedAt = Date.now();
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const continuation = typeof body?.continuation === "string" ? body.continuation.trim().slice(0, 8000) : undefined;
  if (!isUuid(id) || !isUuid(projectId)) return errorResponse("工程执行参数无效。", 400);

  let run: CodingRunView | undefined;
  let runStarted = false;
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { data: runRow, error: runError } = await supabase.from("coding_runs").select("*")
      .eq("id", id).eq("project_id", projectId).maybeSingle();
    if (runError || !runRow) return errorResponse("没有找到该工程执行。", 404);
    run = mapCodingRun(runRow);
    if (run.userId !== user.id) return errorResponse("该 Coding Run 属于另一位项目成员，不能使用你的模型凭证继续执行。", 403);
    if (!["pending", "awaiting_review", "failed"].includes(run.status)) return errorResponse("当前状态不能启动或继续执行。", 409);
    if (run.status !== "pending" && !continuation) return errorResponse("请填写需要 Codex 继续修改的内容。", 400);

    const [{ data: repositoryRow, error: repositoryError }, { data: workspace, error: workspaceError }, { data: profile }] = await Promise.all([
      supabase.from("project_repositories").select("*").eq("id", run.repositoryId).eq("project_id", projectId).maybeSingle(),
      supabase.from("user_project_repository_workspaces").select("*").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    ]);
    if (repositoryError || workspaceError || !repositoryRow || !workspace) return errorResponse("请先配置你在当前设备使用的本地代码仓库。", 409);
    const engineeringTask = engineeringTaskSchema.safeParse(run.executionRequest);
    if (!engineeringTask.success) return errorResponse("工程任务内容不完整，暂时不能执行。", 409);
    const repository = mapRepositoryRow(repositoryRow, workspace);
    const gitProvider = getLocalGitProvider(user.id);
    const repositoryStatus = await gitProvider.getRepositoryStatus(repository);
    if (repositoryStatus.conflicts.length > 0) {
      return errorResponse(
        "当前仓库存在尚未解决的 Git 冲突，请先解决冲突后再继续。",
        409,
        "repository_conflict",
        { status: repositoryStatus },
      );
    }

    const resolved = await resolveModelConfig(user.id, "coding");
    if (resolved.provider !== "openai") return errorResponse("牛牛的 Codex 执行当前只支持 OpenAI 模型。", 422);
    const prompt = await resolveAgentInstructions(supabase, "coding", codingAgentInstructions);
    const codingThread = await getOrCreateAgentThread(supabase, user.id, projectId, "coding");
    run = {
      ...run,
      codexThreadId: run.codexThreadId ?? codingThread.codexThreadId,
    };

    await recordRunStarted(run, profile?.display_name || "项目成员", repositoryStatus);
    runStarted = true;
    const result = await runCodingTask({
      run,
      repository,
      task: engineeringTask.data,
      instructions: `${prompt.instructions}\n\n${adaptiveResponseStyleInstructions}`,
      continuation,
      model: resolved.model,
      apiKey: resolved.apiKey,
      allowDirtyWorkingTree: true,
    });
    const commitMessage = buildCodingCommitMessage({
      implementationSummary: result.implementationSummary,
      changedFiles: result.changedFiles,
    });
    const commit = await gitProvider.commitChanges(repository, commitMessage, true, result.changedFiles);
    const savedResult = {
      ...result,
      headCommitSha: commit.status.headCommit,
      branchAfter: commit.status.currentBranch,
      headAfter: commit.status.headCommit,
      workingTreeAfter: commit.status.changes,
      commitSha: commit.commitSha ?? commit.status.headCommit,
      pushStatus: "pending_confirmation" as const,
    };
    await recordRunCompleted(run, savedResult);
    if (result.codexThreadId !== codingThread.codexThreadId) {
      await setAgentCodexThreadId(supabase, codingThread.id, user.id, result.codexThreadId, codingThread.conversationId);
    }
    const completionMessage = await appendAssistantMessage(supabase, {
      threadId: codingThread.id,
      conversationId: codingThread.conversationId,
      requestId: crypto.randomUUID(),
      content: result.implementationSummary,
      durationMs: Date.now() - requestStartedAt,
    }).catch(() => ({
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: result.implementationSummary,
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - requestStartedAt,
    }));
    return Response.json({ run: { ...run, ...savedResult, status: "completed" }, message: completionMessage }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    if (error instanceof GitProviderError) {
      if (run && runStarted) await recordRunFailed(run, error.message).catch(() => undefined);
      return errorResponse(error.message, 422, error.code, error.details);
    }
    const safeMessage = error instanceof CodingRunnerError
      ? error.safeMessage
      : error instanceof Error && error.message === "No model configuration is available for this user."
        ? "请先为工程师牛牛配置可用模型。"
        : "Codex 执行失败；未创建 PR，也未合并代码。";
    if (run && runStarted) await recordRunFailed(run, safeMessage).catch(() => undefined);
    const status = error instanceof CodingRunnerError ? 503 : 502;
    return errorResponse(safeMessage, status, error instanceof CodingRunnerError ? error.code : undefined, error instanceof CodingRunnerError ? error.details : undefined);
  }
}
