import { modelAgentTypes, type ModelAgentType } from "../../../../lib/model-config/catalog";
import { isUuid } from "../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const validAgent = (value: unknown): value is ModelAgentType => typeof value === "string" && modelAgentTypes.includes(value as ModelAgentType);

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return Response.json({ error: "项目参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data, error } = await supabase.from("handoff_tasks")
      .select("id, source_agent, target_agent, title, content, status, task_kind, priority, due_at, created_at, updated_at, delivered_at, completed_at")
      .eq("project_id", projectId).order("updated_at", { ascending: false }).limit(100);
    if (error) return Response.json({ error: "协作任务加载失败。" }, { status: 500, headers });
    const ids = (data ?? []).map((task) => task.id);
    const { data: attachments } = ids.length ? await supabase.from("handoff_attachments").select("id, handoff_task_id, project_file_id, image_generation_id, label").in("handoff_task_id", ids) : { data: [] };
    return Response.json({ tasks: (data ?? []).map((task) => ({ id: task.id, sourceAgent: task.source_agent, targetAgent: task.target_agent, title: task.title, content: task.content, status: task.status, taskKind: task.task_kind, priority: task.priority, dueAt: task.due_at, createdAt: task.created_at, updatedAt: task.updated_at, deliveredAt: task.delivered_at, completedAt: task.completed_at, attachments: (attachments ?? []).filter((item) => item.handoff_task_id === task.id) })) }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "协作任务加载失败。" }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null); const projectId = body?.projectId; const sourceAgent = body?.sourceAgent; const targetAgent = body?.targetAgent;
  const title = typeof body?.title === "string" ? body.title.trim() : ""; const content = typeof body?.content === "string" ? body.content.trim() : "";
  const taskKind = typeof body?.taskKind === "string" ? body.taskKind : "result"; const priority = typeof body?.priority === "string" ? body.priority : "normal";
  const projectFileIds = Array.isArray(body?.projectFileIds) ? body.projectFileIds.filter(isUuid).slice(0, 20) : [];
  const imageGenerationIds = Array.isArray(body?.imageGenerationIds) ? body.imageGenerationIds.filter(isUuid).slice(0, 20) : [];
  if (!isUuid(projectId) || !validAgent(sourceAgent) || !validAgent(targetAgent) || sourceAgent === targetAgent || !body?.confirmed || !title || !content || title.length > 240 || content.length > 20_000) return Response.json({ error: "请检查并确认协作任务内容。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data, error } = await supabase.rpc("deliver_generic_handoff", { p_project_id: projectId, p_source_agent: sourceAgent, p_target_agent: targetAgent, p_title: title, p_content: content, p_task_kind: taskKind, p_priority: priority, p_project_file_ids: projectFileIds, p_image_generation_ids: imageGenerationIds });
    if (error || !data) return Response.json({ error: "协作任务发送失败。" }, { status: 400, headers });
    return Response.json({ delivered: true, task: data }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "协作任务发送失败。" }, { status: 500, headers });
  }
}
