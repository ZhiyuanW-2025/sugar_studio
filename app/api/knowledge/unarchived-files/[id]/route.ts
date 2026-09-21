import { isUuid } from "../../../../../lib/model-config/http";
import { createClient } from "../../../../../lib/supabase/server";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ error: "文件参数无效。" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "请先登录后继续。" }, { status: 401 });
  const { data: file } = await supabase.from("project_files").select("project_id,storage_path,inbox_owner_id").eq("id", id).maybeSingle();
  if (!file || file.inbox_owner_id !== user.id) return Response.json({ error: "没有找到该文件。" }, { status: 404 });
  await supabase.storage.from("project-files").remove([file.storage_path]);
  const { error } = await supabase.rpc("remove_project_file", { p_project_id: file.project_id, p_file_id: id });
  if (error) return Response.json({ error: "文件记录清理失败。" }, { status: 500 });
  return Response.json({ deleted: true });
}
