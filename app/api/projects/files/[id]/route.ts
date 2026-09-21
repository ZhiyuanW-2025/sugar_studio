import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers: responseHeaders });
}

function accessErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
  return errorResponse("暂时无法访问项目文件，请稍后重试。", 500);
}

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await getParams(context);
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(id) || !isUuid(projectId)) return errorResponse("文件参数无效。", 400);

  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data: file, error } = await supabase
      .from("project_files")
      .select("storage_path")
      .eq("id", id)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error || !file) return errorResponse("没有找到该项目文件。", 404);

    const { data, error: signedUrlError } = await supabase.storage
      .from("project-files")
      .createSignedUrl(file.storage_path, 60);
    if (signedUrlError || !data?.signedUrl) return errorResponse("暂时无法打开该文件。", 500);

    return Response.redirect(data.signedUrl, 302);
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await getParams(context);
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(id) || !isUuid(projectId)) return errorResponse("文件参数无效。", 400);

  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data: file, error } = await supabase
      .from("project_files")
      .select("storage_path")
      .eq("id", id)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error || !file) return errorResponse("没有找到该项目文件。", 404);

    const { error: metadataError } = await supabase.rpc("remove_project_file", {
      p_project_id: projectId,
      p_file_id: id,
    });
    if (metadataError) {
      if (metadataError.message.includes("active Feishu operation")) return errorResponse("这份文件还有待执行的飞书操作，请先完成或取消后再删除。", 409);
      return errorResponse("文件记录删除失败，请稍后重试。", 500);
    }

    // Metadata is the user-visible source of truth. Storage cleanup is
    // deliberately best-effort so a missing/already-moved object cannot leave
    // a permanent ghost row in the project file list.
    await supabase.storage.from("project-files").remove([file.storage_path]);

    return Response.json({ deleted: true }, { headers: responseHeaders });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
