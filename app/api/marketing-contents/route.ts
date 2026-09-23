import { isMarketingPlatform } from "../../../lib/marketing/types";
import { isUuid } from "../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../lib/projects/access";
import { createAdminClient } from "../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function accessError(error: unknown) {
  if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
  return Response.json({ error: "营销内容操作失败，请稍后重试。" }, { status: 500, headers });
}

function serialize(item: Record<string, unknown>) {
  return {
    id: item.id,
    projectId: item.project_id,
    platform: item.platform,
    title: item.title,
    summary: item.summary,
    content: item.content,
    coverCopy: item.cover_copy,
    tags: item.tags,
    imagePlan: item.image_plan,
    status: item.status,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    publishAccount: item.publish_account ?? "",
    scheduledAt: item.scheduled_at ?? null,
    completedAt: item.completed_at ?? null,
    images: Array.isArray(item.images) ? item.images : [],
  };
}

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return Response.json({ error: "项目参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data, error } = await supabase.from("marketing_contents")
      .select("id,project_id,platform,title,summary,content,cover_copy,tags,image_plan,status,publish_account,scheduled_at,completed_at,created_at,updated_at")
      .eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false });
    if (error) return Response.json({ error: "暂时无法加载营销内容。" }, { status: 500, headers });
    const ids = (data ?? []).map((item) => item.id);
    const { data: images } = ids.length ? await supabase.from("marketing_content_images").select("id,marketing_content_id,image_generation_id,storage_path,file_name,mime_type,source,is_official,created_at").in("marketing_content_id", ids).order("created_at", { ascending: false }) : { data: [] };
    const generationIds = (images ?? []).map((image) => image.image_generation_id).filter((id): id is string => typeof id === "string");
    const { data: generations } = generationIds.length ? await createAdminClient().from("image_generations").select("id,storage_path").in("id", generationIds) : { data: [] };
    const generationPath = new Map((generations ?? []).map((item) => [item.id, item.storage_path]));
    const imageRows = (images ?? []).map((image) => ({ ...image, storage_path: image.storage_path ?? (image.image_generation_id ? generationPath.get(image.image_generation_id) ?? null : null) }));
    const paths = imageRows.map((image) => image.storage_path).filter((path): path is string => typeof path === "string");
    const signed = paths.length ? await createAdminClient().storage.from("agent-images").createSignedUrls(paths, 3600) : { data: [] };
    const signedByPath = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
    const contents = (data ?? []).map((item) => serialize({ ...item, images: imageRows.filter((image) => image.marketing_content_id === item.id).map((image) => ({ id: image.id, imageGenerationId: image.image_generation_id, fileName: image.file_name, mimeType: image.mime_type, source: image.source, isOfficial: image.is_official, storagePath: image.storage_path, imageUrl: image.storage_path ? signedByPath.get(image.storage_path) ?? null : null, createdAt: image.created_at })) }));
    return Response.json({ contents }, { headers });
  } catch (error) { return accessError(error); }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const platform = body?.platform;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!isUuid(projectId) || !isMarketingPlatform(platform) || !title || title.length > 240 || !content || content.length > 100_000) {
    return Response.json({ error: "营销内容参数无效。" }, { status: 400, headers });
  }
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { data, error } = await supabase.from("marketing_contents").insert({
      project_id: projectId,
      platform,
      title,
      content,
      summary: typeof body?.summary === "string" ? body.summary.trim().slice(0, 2000) : "",
      cover_copy: typeof body?.coverCopy === "string" ? body.coverCopy.trim().slice(0, 1000) : "",
      image_plan: typeof body?.imagePlan === "string" ? body.imagePlan.trim().slice(0, 20_000) : "",
      tags: Array.isArray(body?.tags) ? body.tags.filter((item: unknown) => typeof item === "string").slice(0, 30) : [],
      created_by: user.id,
      updated_by: user.id,
      publish_account: typeof body?.publishAccount === "string" ? body.publishAccount.trim().slice(0, 200) : "",
      scheduled_at: typeof body?.scheduledAt === "string" && body.scheduledAt ? body.scheduledAt : null,
    }).select("id,project_id,platform,title,summary,content,cover_copy,tags,image_plan,status,publish_account,scheduled_at,completed_at,created_at,updated_at").single();
    if (error || !data) return Response.json({ error: "营销草稿保存失败。" }, { status: 500, headers });
    return Response.json({ created: true, content: serialize(data) }, { status: 201, headers });
  } catch (error) { return accessError(error); }
}
