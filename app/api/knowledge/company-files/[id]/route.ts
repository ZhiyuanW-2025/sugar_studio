import { WorkspaceAccessError, requireWorkspaceMember } from "../../../../../lib/knowledge/access";
import { isUuid } from "../../../../../lib/model-config/http";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
const errorResponse = (error: string, status: number) => Response.json({ error }, { status, headers });

function accessErrorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) return errorResponse(error.message, error.status);
  return errorResponse("暂时无法访问公司知识文件。", 500);
}

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await getParams(context);
  if (!isUuid(id)) return errorResponse("文件参数无效。", 400);
  try {
    const { supabase } = await requireWorkspaceMember();
    const { data: file, error } = await supabase.from("company_files").select("storage_path").eq("id", id).maybeSingle();
    if (error || !file) return errorResponse("没有找到公司知识文件。", 404);
    const { data, error: signedUrlError } = await supabase.storage
      .from("company-knowledge")
      .createSignedUrl(file.storage_path, 60);
    if (signedUrlError || !data?.signedUrl) return errorResponse("暂时无法打开该文件。", 500);
    return Response.redirect(data.signedUrl, 302);
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await getParams(context);
  if (!isUuid(id)) return errorResponse("文件参数无效。", 400);
  try {
    const { supabase } = await requireWorkspaceMember();
    const { data: file, error } = await supabase.from("company_files").select("storage_path").eq("id", id).maybeSingle();
    if (error || !file) return errorResponse("没有找到公司知识文件。", 404);
    const { error: storageError } = await supabase.storage.from("company-knowledge").remove([file.storage_path]);
    if (storageError) return errorResponse("文件删除失败，请稍后重试。", 500);
    const { error: metadataError } = await supabase.rpc("remove_company_file", { p_file_id: id });
    if (metadataError) return errorResponse("文件已移除，但记录清理失败，请稍后刷新。", 500);
    return Response.json({ deleted: true }, { headers });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
