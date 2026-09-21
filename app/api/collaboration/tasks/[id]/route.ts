import { isUuid } from "../../../../../lib/model-config/http";
import { createClient } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic"; const headers = { "Cache-Control": "no-store" };
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params; const body = await request.json().catch(() => null); const status = body?.status;
  if (!isUuid(id) || !["delivered","in_progress","blocked","completed","cancelled"].includes(status)) return Response.json({ error: "任务状态无效。" }, { status: 400, headers });
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  const { data, error } = await supabase.rpc("update_handoff_task_status", { p_task_id: id, p_status: status });
  if (error || !data) return Response.json({ error: "任务状态更新失败。" }, { status: 403, headers });
  return Response.json({ updated: true, task: data }, { headers });
}
