import { isUuid } from "../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";
import { progressCategories, progressCategoryForEvent, visibleProjectProgressEventTypes, type ProgressCategory } from "../../../../lib/projects/progress-events";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers });
const agentNames: Record<string, string> = {
  planning: "制作人小花", coding: "工程师牛牛", design: "艺术家小熊",
  client: "客户伙伴小雪", procurement: "金牌买手拉夫",
  marketing: "宣传委员豆豆",
};

type ActivityRow = {
  id: string; project_id: string; user_id: string; event_type: string; actor_type: "user" | "agent";
  actor: string; summary: string; related_entity_id: string | null; category?: string;
  progress_status?: string; source_type?: string; details?: Record<string, unknown>; created_at: string;
};

async function memberNames(supabase: Awaited<ReturnType<typeof createClient>>, rows: ActivityRow[]) {
  const ids = [...new Set(rows.map((item) => item.user_id).filter(Boolean))];
  if (!ids.length) return new Map<string, string>();
  const { data } = await supabase.from("profiles").select("id,display_name").in("id", ids);
  return new Map((data ?? []).map((profile) => [profile.id, profile.display_name || "项目成员"]));
}

function serializeActivity(item: ActivityRow, names: Map<string, string>, projectName?: string) {
  const category = progressCategories.includes(item.category as ProgressCategory)
    ? item.category as ProgressCategory
    : progressCategoryForEvent(item.event_type);
  return {
    id: item.id,
    projectId: item.project_id,
    ...(projectName ? { projectName } : {}),
    eventType: item.event_type,
    category,
    status: item.progress_status === "failed" ? "failed" : "completed",
    sourceType: item.source_type === "manual" ? "manual" : "system_action",
    actorType: item.actor_type,
    actor: item.actor,
    memberName: names.get(item.user_id) || "项目成员",
    summary: item.summary,
    details: item.details ?? {},
    relatedEntityId: item.related_entity_id,
    createdAt: item.created_at,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const mine = url.searchParams.get("mine") === "true";

  if (mine) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse("请先登录后继续。", 401);
    const { data, error } = await supabase
      .from("project_activities")
      .select("id, project_id, user_id, event_type, category, progress_status, source_type, actor_type, actor, summary, details, related_entity_id, created_at")
      .eq("user_id", user.id)
      .in("event_type", [...visibleProjectProgressEventTypes])
      .order("created_at", { ascending: false })
      .limit(150);
    if (error) return errorResponse("暂时无法加载我的工作日志。", 500);
    const projectIds = [...new Set((data ?? []).map((item) => item.project_id))];
    const projectNames = new Map<string, string>();
    if (projectIds.length) {
      const { data: projects } = await supabase.from("projects").select("id, name").in("id", projectIds);
      for (const project of projects ?? []) projectNames.set(project.id, project.name);
    }
    const rows = (data ?? []) as ActivityRow[];
    const names = await memberNames(supabase, rows);
    return Response.json({ activities: rows.map((item) => serializeActivity(item, names, projectNames.get(item.project_id) || "项目")) }, { headers });
  }

  if (!isUuid(projectId)) return errorResponse("项目参数无效。", 400);

  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data, error } = await supabase
      .from("project_activities")
      .select("id, project_id, user_id, event_type, category, progress_status, source_type, actor_type, actor, summary, details, related_entity_id, created_at")
      .eq("project_id", projectId)
      .in("event_type", [...visibleProjectProgressEventTypes])
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return errorResponse("暂时无法加载活动记录。", 500);
    const rows = (data ?? []) as ActivityRow[];
    const names = await memberNames(supabase, rows);
    return Response.json({ activities: rows.map((item) => serializeActivity(item, names)) }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    return errorResponse("暂时无法加载活动记录。", 500);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const sourceMessageId = body?.sourceMessageId;
  const summary = typeof body?.summary === "string" ? body.summary.replace(/\s+/g, " ").trim() : "";
  const category = body?.category as ProgressCategory;
  if (!isUuid(projectId) || !isUuid(sourceMessageId) || !progressCategories.includes(category)
    || summary.length < 3 || summary.length > 240) {
    return errorResponse("进展内容无效，请填写 3–240 个字。", 400);
  }

  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { data: sourceMessage, error: messageError } = await supabase.from("messages")
      .select("id,thread_id,role")
      .eq("id", sourceMessageId)
      .eq("role", "assistant")
      .maybeSingle();
    if (messageError || !sourceMessage) return errorResponse("没有找到这条 Agent 回复。", 404);
    const { data: thread } = await supabase.from("agent_threads")
      .select("id,project_id,agent_type")
      .eq("id", sourceMessage.thread_id)
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!thread) return errorResponse("这条回复不属于你在当前项目中的对话。", 403);
    const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
    const { data: created, error } = await createAdminClient().from("project_activities").insert({
      project_id: projectId,
      user_id: user.id,
      event_type: "manual_progress",
      category,
      progress_status: "completed",
      source_type: "manual",
      actor_type: "user",
      actor: profile?.display_name || user.email || "项目成员",
      summary,
      related_entity_id: sourceMessageId,
      details: { source_agent_type: thread.agent_type, source_agent_name: agentNames[thread.agent_type] || "Agent" },
    }).select("id").single();
    if (error || !created) return errorResponse("暂时无法记录项目进展。", 500);
    return Response.json({ created: true, id: created.id }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    return errorResponse("暂时无法记录项目进展。", 500);
  }
}
