import { engineeringTaskFromHandoff, engineeringTaskSchema } from "../../../lib/coding-runs/engineering-task";
import { mapCodingRun } from "../../../lib/coding-runs/service";
import type { EngineeringTaskView } from "../../../lib/coding-runs/types";
import { getLocalGitProvider } from "../../../lib/git/local-git-provider";
import { GitProviderError } from "../../../lib/git/provider";
import { mapRepositoryRow } from "../../../lib/git/repository-service";
import { isUuid } from "../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return errorResponse("项目参数无效。", 400);
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const [{ data: handoffs, error: taskError }, { data: rows, error: runError }] = await Promise.all([
      supabase.from("handoff_tasks")
        .select("id, title, content, brief, delivered_at")
        .eq("project_id", projectId)
        .eq("target_agent", "coding")
        .eq("status", "delivered")
        .order("delivered_at", { ascending: false }),
      supabase.from("coding_runs").select("*").eq("project_id", projectId).eq("user_id", user.id),
    ]);
    if (taskError || runError) return errorResponse("暂时无法读取工程任务。", 500);

    const runs = (rows ?? []).map((row) => mapCodingRun(row));
    const runByHandoff = new Map(runs.filter((run) => run.handoffTaskId).map((run) => [run.handoffTaskId, run]));
    const result: EngineeringTaskView[] = [];
    for (const handoff of handoffs ?? []) {
      const task = engineeringTaskFromHandoff(handoff);
      if (!task) continue;
      result.push({
        id: handoff.id,
        title: handoff.title,
        task,
        sourceKind: "xiaohua_handoff",
        deliveredAt: handoff.delivered_at,
        run: runByHandoff.get(handoff.id) ?? null,
      });
    }
    for (const run of runs.filter((item) => item.sourceKind === "niuniu_conversation")) {
      result.push({
        id: run.id,
        title: run.executionRequest.title,
        task: run.executionRequest,
        sourceKind: "niuniu_conversation",
        deliveredAt: run.createdAt,
        run,
      });
    }
    result.sort((a, b) => String(b.deliveredAt || "").localeCompare(String(a.deliveredAt || "")));
    return Response.json({ tasks: result }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    return errorResponse("暂时无法读取工程任务。", 500);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const handoffTaskId = body?.handoffTaskId;
  const sourceMessageId = body?.sourceMessageId;
  const directTask = engineeringTaskSchema.safeParse(body?.task);
  const isHandoff = isUuid(handoffTaskId);
  const isConversation = isUuid(sourceMessageId) && directTask.success;
  if (!isUuid(projectId) || (!isHandoff && !isConversation)) return errorResponse("工程任务参数无效。", 400);

  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const [{ data: repositoryRow, error: repositoryError }, { data: workspace, error: workspaceError }] = await Promise.all([
      supabase.from("project_repositories").select("*").eq("project_id", projectId).maybeSingle(),
      supabase.from("user_project_repository_workspaces").select("*").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
    ]);
    if (repositoryError || workspaceError || !repositoryRow || !workspace) return errorResponse("请先配置你在当前设备使用的本地代码仓库。", 409);
    const repository = mapRepositoryRow(repositoryRow, workspace);
    const repositoryStatus = await getLocalGitProvider(user.id).getRepositoryStatus(repository);

    if (isHandoff) {
      const { data: task, error: taskError } = await supabase.from("handoff_tasks")
        .select("id, status, target_agent")
        .eq("id", handoffTaskId).eq("project_id", projectId).maybeSingle();
      if (taskError || !task) return errorResponse("没有找到该工程任务。", 404);
      if (task.status !== "delivered" || task.target_agent !== "coding") {
        return errorResponse("只有用户已经确认并发送给牛牛的工程任务才能执行。", 409);
      }
      const { data, error } = await supabase.rpc("create_local_coding_run", {
        p_project_id: projectId,
        p_handoff_task_id: handoffTaskId,
        p_current_branch: repositoryStatus.currentBranch,
      });
      if (error || !data) {
        const message = error?.message.includes("repository") ? "请先为当前项目绑定代码仓库。" : "暂时无法创建工程执行。";
        return errorResponse(message, error?.message.includes("repository") ? 409 : 500);
      }
      return Response.json({ run: mapCodingRun(data) }, { status: 201, headers });
    }

    if (!directTask.success) return errorResponse("工程任务参数无效。", 400);
    const task = directTask.data;
    const { data, error } = await supabase.rpc("create_conversation_coding_run", {
      p_project_id: projectId,
      p_source_message_id: sourceMessageId,
      p_title: task.title,
      p_instruction: task.instruction,
      p_current_branch: repositoryStatus.currentBranch,
    });
    if (error || !data) {
      const accessDenied = error?.code === "42501";
      const repositoryMissing = error?.message.includes("repository");
      return errorResponse(
        accessDenied ? "当前对话不属于你或当前项目。" : repositoryMissing ? "请先为当前项目绑定代码仓库。" : "暂时无法从当前对话创建工程任务。",
        accessDenied ? 403 : repositoryMissing ? 409 : 500,
      );
    }
    return Response.json({ run: mapCodingRun(data) }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    if (error instanceof GitProviderError) return errorResponse(error.message, 422);
    return errorResponse("暂时无法创建工程执行。", 500);
  }
}
