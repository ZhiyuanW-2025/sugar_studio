import { downloadFeishuDriveFile } from "../../../../../lib/feishu/client";
import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const headers = { "Cache-Control": "no-store" };
const bucket = "agent-images";
const supported = new Set(["image/png", "image/jpeg", "image/webp"]);
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

function extensionMime(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const contentId = url.searchParams.get("contentId");
  const contentKind = url.searchParams.get("contentKind");
  if (!isUuid(projectId)) return fail("项目参数无效。", 400);
  try {
    const { supabase } = await requireProjectMember(projectId);
    if (contentId && contentKind === "feishu_drive") {
      if (!isUuid(contentId)) return fail("图片参数无效。", 400);
      const { data } = await supabase.from("feishu_drive_items")
        .select("id,file_token,file_name,item_type")
        .eq("id", contentId).eq("project_id", projectId).eq("item_type", "image").maybeSingle();
      if (!data) return fail("没有找到该项目图片。", 404);
      const downloaded = await downloadFeishuDriveFile(data.file_token, 25 * 1024 * 1024);
      const mimeType = downloaded.contentType?.split(";")[0] || extensionMime(data.file_name);
      if (!mimeType || !supported.has(mimeType)) return fail("目前仅支持 PNG、JPEG 和 WebP 图片。", 415);
      return new Response(downloaded.bytes, { headers: { "Content-Type": mimeType, "Cache-Control": "private, max-age=300" } });
    }
    if (contentId && contentKind === "design_asset") {
      if (!isUuid(contentId)) return fail("图片参数无效。", 400);
      const { data } = await supabase.from("design_assets").select("id,storage_path,mime_type")
        .eq("id", contentId).eq("project_id", projectId).maybeSingle();
      if (!data) return fail("没有找到该参考图片。", 404);
      const { data: blob } = await createAdminClient().storage.from(bucket).download(data.storage_path);
      if (!blob) return fail("暂时无法读取参考图片。", 500);
      return new Response(await blob.arrayBuffer(), { headers: { "Content-Type": data.mime_type, "Cache-Control": "private, max-age=300" } });
    }

    const [{ data: driveItems, error: driveError }, { data: assets, error: assetsError }] = await Promise.all([
      supabase.from("feishu_drive_items")
        .select("id,file_name,path_text,parent_file_token,source_url,source_updated_at,content_summary")
        .eq("project_id", projectId).eq("item_type", "image")
        .order("path_text", { ascending: true }).limit(500),
      supabase.from("design_assets").select("id,file_name,created_at")
        .eq("project_id", projectId).order("created_at", { ascending: false }).limit(30),
    ]);
    if (driveError || assetsError) return fail("暂时无法读取项目图片。", 500);
    return Response.json({
      sources: [
        ...(driveItems ?? []).filter((item) => Boolean(extensionMime(item.file_name))).map((item) => ({
          kind: "feishu_drive", id: item.id, name: item.file_name,
          path: item.path_text, summary: item.content_summary,
          modifiedAt: item.source_updated_at,
          previewUrl: `/api/agents/design/sources?projectId=${encodeURIComponent(projectId)}&contentKind=feishu_drive&contentId=${item.id}`,
        })),
        ...(assets ?? []).map((item) => ({
          kind: "design_asset", id: item.id, name: item.file_name,
          path: "本次对话上传", modifiedAt: item.created_at,
          previewUrl: `/api/agents/design/sources?projectId=${encodeURIComponent(projectId)}&contentKind=design_asset&contentId=${item.id}`,
        })),
      ],
    }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    return fail("暂时无法读取项目图片。", 500);
  }
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const projectId = form?.get("projectId");
  const file = form?.get("file");
  if (!isUuid(projectId) || !(file instanceof File)) return fail("上传参数无效。", 400);
  if (!supported.has(file.type) || file.size <= 0 || file.size > 25 * 1024 * 1024) {
    return fail("参考图必须是 25 MB 以内的 PNG、JPEG 或 WebP。", 415);
  }
  try {
    const { user } = await requireProjectMember(projectId);
    const admin = createAdminClient();
    const id = crypto.randomUUID();
    const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
    const storagePath = `${projectId}/sources/${user.id}/${id}.${extension}`;
    const { error: uploadError } = await admin.storage.from(bucket).upload(storagePath, await file.arrayBuffer(), { contentType: file.type, upsert: false });
    if (uploadError) return fail("参考图片上传失败。", 500);
    const { data, error } = await admin.from("design_assets").insert({
      id, project_id: projectId, user_id: user.id, file_name: file.name.slice(0, 255),
      storage_path: storagePath, mime_type: file.type, size_bytes: file.size,
    }).select("id,file_name").single();
    if (error || !data) {
      await admin.storage.from(bucket).remove([storagePath]);
      return fail("参考图片保存失败。", 500);
    }
    return Response.json({ source: {
      kind: "design_asset", id: data.id, name: data.file_name, path: "本次对话上传",
      previewUrl: `/api/agents/design/sources?projectId=${encodeURIComponent(projectId)}&contentKind=design_asset&contentId=${data.id}`,
    } }, { status: 201, headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    return fail("参考图片上传失败。", 500);
  }
}
