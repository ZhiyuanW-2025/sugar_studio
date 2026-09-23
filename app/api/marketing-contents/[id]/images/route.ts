import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
const bucket = "agent-images";
function fail(error: unknown) { if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status }); return Response.json({ error: "图片操作失败，请稍后重试。" }, { status: 500 }); }

export async function POST(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  const form = await request.formData().catch(() => null);
  const body = form ? null : await request.json().catch(() => null);
  const projectId = String(form?.get("projectId") ?? body?.projectId ?? "");
  if (!isUuid(id) || !isUuid(projectId)) return Response.json({ error: "参数无效。" }, { status: 400 });
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { data: content } = await supabase.from("marketing_contents").select("id").eq("id", id).eq("project_id", projectId).maybeSingle();
    if (!content) return Response.json({ error: "没有找到该宣传作品。" }, { status: 404 });
    const generationId = String(form?.get("imageGenerationId") ?? body?.imageGenerationId ?? "");
    let row: Record<string, unknown>;
    if (isUuid(generationId)) {
      const { data: generation } = await supabase.from("image_generations").select("id,storage_path").eq("id", generationId).eq("project_id", projectId).eq("status", "completed").maybeSingle();
      if (!generation) return Response.json({ error: "没有找到已完成的生成图片。" }, { status: 404 });
      const { data, error } = await supabase.from("marketing_content_images").insert({ marketing_content_id: id, image_generation_id: generation.id, file_name: `小熊生成-${generation.id.slice(0, 8)}.png`, mime_type: "image/png", source: "xiaoxiong_generated", created_by: user.id }).select("id").single();
      if (error) return Response.json({ error: "图片加入草稿失败。" }, { status: 500 }); row = data;
    } else {
      const file = form?.get("file");
      if (!(file instanceof File) || !file.type.startsWith("image/")) return Response.json({ error: "请上传图片文件。" }, { status: 400 });
      const path = `marketing/${projectId}/${id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const admin = createAdminClient();
      const uploaded = await admin.storage.from(bucket).upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: false });
      if (uploaded.error) return Response.json({ error: "图片上传失败。" }, { status: 500 });
      const { data, error } = await supabase.from("marketing_content_images").insert({ marketing_content_id: id, storage_path: path, file_name: file.name, mime_type: file.type, source: "user_upload", created_by: user.id }).select("id").single();
      if (error) return Response.json({ error: "图片记录保存失败。" }, { status: 500 }); row = data;
    }
    return Response.json({ created: true, image: row });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params; const body = await request.json().catch(() => null); const projectId = body?.projectId; const imageId = body?.imageId;
  if (!isUuid(id) || !isUuid(projectId) || !isUuid(imageId) || typeof body?.isOfficial !== "boolean") return Response.json({ error: "参数无效。" }, { status: 400 });
  try { const { supabase } = await requireProjectMember(projectId); const { error } = await supabase.from("marketing_content_images").update({ is_official: body.isOfficial }).eq("id", imageId).eq("marketing_content_id", id); if (error) return Response.json({ error: "图片状态更新失败。" }, { status: 500 }); return Response.json({ updated: true }); } catch (error) { return fail(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params; const url = new URL(request.url); const projectId = url.searchParams.get("projectId"); const imageId = url.searchParams.get("imageId");
  if (!isUuid(id) || !isUuid(projectId) || !isUuid(imageId)) return Response.json({ error: "参数无效。" }, { status: 400 });
  try { const { supabase } = await requireProjectMember(projectId); const { data } = await supabase.from("marketing_content_images").select("storage_path").eq("id", imageId).eq("marketing_content_id", id).maybeSingle(); if (data?.storage_path) await createAdminClient().storage.from(bucket).remove([data.storage_path]); await supabase.from("marketing_content_images").delete().eq("id", imageId).eq("marketing_content_id", id); return Response.json({ deleted: true }); } catch (error) { return fail(error); }
}
