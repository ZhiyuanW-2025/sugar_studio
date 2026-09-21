import { isUuid } from "../../../../lib/model-config/http";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params; const body = await request.json().catch(() => null); const action = body?.action;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!isUuid(id) || !["select", "rename", "archive"].includes(action) || (action === "rename" && (!title || title.length > 160))) {
    return Response.json({ error: "对话操作参数无效。" }, { status: 400, headers });
  }
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  const result = action === "select"
    ? await supabase.rpc("set_current_agent_conversation", { p_conversation_id: id })
    : await supabase.rpc("update_agent_conversation", { p_conversation_id: id, p_title: title || "已归档对话", p_archive: action === "archive" });
  if (result.error || !result.data) return Response.json({ error: action === "archive" ? "归档对话失败。" : "更新对话失败。" }, { status: 403, headers });
  return Response.json({ ok: true, conversation: result.data }, { headers });
}
