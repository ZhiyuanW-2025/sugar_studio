import { editImage, generateImage } from "../../../../../lib/agents/tools/image-task-adapter";
import {
  isImageQuality,
  isImageSize,
  type ImageQuality,
  type ImageSize,
} from "../../../../../lib/image-generation/catalog";
import type {
  ImageGenerationSummary,
  ImageOperation,
  ImageSourceKind,
} from "../../../../../lib/image-generation/types";
import { resolveImageModelConfig } from "../../../../../lib/image-generation/service";
import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { getOrCreateAgentThread } from "../../../../../lib/agents/thread-service";
import { downloadFeishuDriveFile } from "../../../../../lib/feishu/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const responseHeaders = { "Cache-Control": "no-store" };
const bucket = "agent-images";
const signedUrlLifetimeSeconds = 60 * 60;

type GenerationRow = {
  id: string;
  request_id: string;
  operation: ImageOperation;
  source_generation_id: string | null;
  source_project_file_id: string | null;
  source_feishu_drive_item_id: string | null;
  source_design_asset_id: string | null;
  batch_id: string | null;
  batch_index: number;
  prompt: string;
  provider: "openai";
  model: string;
  size: ImageSize;
  quality: ImageQuality;
  status: "running" | "completed" | "failed";
  review_status: "draft" | "approved";
  approved_by: string | null;
  approved_at: string | null;
  storage_path: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

type SourceImage = {
  kind: ImageSourceKind;
  id: string;
  bytes: Uint8Array;
  fileName: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  storagePath: string;
};

class ImageSourceError extends Error {
  constructor(public readonly status: 404 | 415 | 500, message: string) {
    super(message);
  }
}

const generationSelect = "id, request_id, operation, source_generation_id, source_project_file_id, source_feishu_drive_item_id, source_design_asset_id, batch_id, batch_index, prompt, provider, model, size, quality, status, review_status, approved_by, approved_at, storage_path, error_message, created_at, completed_at";
const supportedSourceMimeTypes = ["image/png", "image/jpeg", "image/webp"] as const;

function isSupportedSourceMimeType(value: string): value is SourceImage["mimeType"] {
  return supportedSourceMimeTypes.includes(value as SourceImage["mimeType"]);
}

function sourceExtension(mimeType: SourceImage["mimeType"]) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

async function resolveSourceImage(input: {
  kind: ImageSourceKind;
  id: string;
  projectId: string;
  supabase: Awaited<ReturnType<typeof requireProjectMember>>["supabase"];
  admin: ReturnType<typeof createAdminClient>;
}): Promise<SourceImage> {
  if (input.kind === "generation") {
    const { data, error } = await input.admin
      .from("image_generations")
      .select("id, storage_path, mime_type, status")
      .eq("id", input.id)
      .eq("project_id", input.projectId)
      .maybeSingle();
    if (error) throw new ImageSourceError(500, "暂时无法读取源图片。");
    if (!data || data.status !== "completed" || !data.storage_path || !data.mime_type) {
      throw new ImageSourceError(404, "没有找到可用于修改的项目图片。");
    }
    if (!isSupportedSourceMimeType(data.mime_type)) {
      throw new ImageSourceError(415, "源图片格式不受支持。");
    }
    const { data: blob, error: downloadError } = await input.admin.storage
      .from(bucket)
      .download(data.storage_path);
    if (downloadError || !blob) throw new ImageSourceError(500, "暂时无法读取源图片。");
    return {
      kind: input.kind,
      id: data.id,
      bytes: new Uint8Array(await blob.arrayBuffer()),
      fileName: `source.${sourceExtension(data.mime_type)}`,
      mimeType: data.mime_type,
      storagePath: data.storage_path,
    };
  }

  if (input.kind === "feishu_drive") {
    const { data, error } = await input.supabase.from("feishu_drive_items")
      .select("id,file_token,file_name,file_extension,item_type")
      .eq("id", input.id).eq("project_id", input.projectId).eq("item_type", "image").maybeSingle();
    if (error) throw new ImageSourceError(500, "暂时无法读取飞书云盘图片。");
    if (!data) throw new ImageSourceError(404, "没有找到该项目的飞书云盘图片。");
    const downloaded = await downloadFeishuDriveFile(data.file_token, 25 * 1024 * 1024);
    const sourceExtensionValue = String(data.file_extension ?? "").toLowerCase();
    const inferred = sourceExtensionValue === "png" ? "image/png"
      : sourceExtensionValue === "webp" ? "image/webp"
        : ["jpg", "jpeg"].includes(sourceExtensionValue) ? "image/jpeg" : null;
    const mimeType = downloaded.contentType?.split(";")[0] || inferred;
    if (!mimeType || !isSupportedSourceMimeType(mimeType)) throw new ImageSourceError(415, "目前仅支持 PNG、JPEG 和 WebP 图片。");
    return { kind: input.kind, id: data.id, bytes: downloaded.bytes, fileName: data.file_name, mimeType, storagePath: "" };
  }

  if (input.kind === "design_asset") {
    const { data, error } = await input.supabase.from("design_assets")
      .select("id,file_name,storage_path,mime_type,size_bytes")
      .eq("id", input.id).eq("project_id", input.projectId).maybeSingle();
    if (error) throw new ImageSourceError(500, "暂时无法读取上传的参考图片。");
    if (!data || !isSupportedSourceMimeType(data.mime_type) || data.size_bytes > 25 * 1024 * 1024) {
      throw new ImageSourceError(404, "没有找到可用的参考图片。");
    }
    const { data: blob, error: downloadError } = await input.admin.storage.from(bucket).download(data.storage_path);
    if (downloadError || !blob) throw new ImageSourceError(500, "暂时无法读取上传的参考图片。");
    return { kind: input.kind, id: data.id, bytes: new Uint8Array(await blob.arrayBuffer()), fileName: data.file_name, mimeType: data.mime_type, storagePath: data.storage_path };
  }

  const { data, error } = await input.supabase
    .from("project_files")
    .select("id, file_name, storage_path, mime_type, size")
    .eq("id", input.id)
    .eq("project_id", input.projectId)
    .maybeSingle();
  if (error) throw new ImageSourceError(500, "暂时无法读取项目参考图。");
  if (!data) throw new ImageSourceError(404, "没有找到该项目参考图。");
  if (!isSupportedSourceMimeType(data.mime_type) || data.size > 50 * 1024 * 1024) {
    throw new ImageSourceError(415, "参考图必须是 50 MB 以内的 PNG、JPEG 或 WebP。" );
  }
  const { data: blob, error: downloadError } = await input.supabase.storage
    .from("project-files")
    .download(data.storage_path);
  if (downloadError || !blob) throw new ImageSourceError(500, "暂时无法读取项目参考图。");
  return {
    kind: input.kind,
    id: data.id,
    bytes: new Uint8Array(await blob.arrayBuffer()),
    fileName: data.file_name,
    mimeType: data.mime_type,
    storagePath: data.storage_path,
  };
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: responseHeaders });
}

async function toSummary(row: GenerationRow): Promise<ImageGenerationSummary> {
  let imageUrl: string | null = null;
  let downloadUrl: string | null = null;
  if (row.status === "completed" && row.storage_path) {
    const storage = createAdminClient().storage.from(bucket);
    const [preview, download] = await Promise.all([
      storage.createSignedUrl(row.storage_path, signedUrlLifetimeSeconds),
      storage.createSignedUrl(row.storage_path, signedUrlLifetimeSeconds, {
        download: `sugar-agent-${row.id}.png`,
      }),
    ]);
    imageUrl = preview.data?.signedUrl ?? null;
    downloadUrl = download.data?.signedUrl ?? null;
  }

  return {
    id: row.id,
    requestId: row.request_id,
    operation: row.operation,
    sourceKind: row.source_generation_id
      ? "generation"
      : row.source_project_file_id
        ? "project_file"
        : row.source_feishu_drive_item_id
          ? "feishu_drive"
          : row.source_design_asset_id
            ? "design_asset"
            : null,
    sourceId: row.source_generation_id ?? row.source_project_file_id ?? row.source_feishu_drive_item_id ?? row.source_design_asset_id,
    batchId: row.batch_id,
    batchIndex: row.batch_index,
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    size: row.size,
    quality: row.quality,
    status: row.status,
    reviewStatus: row.review_status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    imageUrl,
    downloadUrl,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function safeFailureMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const rawMessage = error instanceof Error ? error.message : "";
  const status = typeof error === "object" && error && "status" in error
    ? Number((error as { status?: unknown }).status)
    : null;
  if (code.includes("moderation") || /safety|moderation/i.test(rawMessage)) {
    return "图片请求触发了安全检查，请调整文字或参考图后重试。";
  }
  if (/invalid.*image|image.*invalid|unsupported.*image/i.test(`${code} ${rawMessage}`)) {
    return "参考图片无法被模型读取，请换用 PNG、JPEG 或 WebP 图片后重试。";
  }
  if (/organization.*verif|verify.*organization/i.test(rawMessage)) {
    return "OpenAI 组织需要完成验证后才能使用所选图片模型。";
  }
  if (status === 400) return "图片生成参数未被模型接受，请稍后重试或更换参考图。";
  if (status === 401 || status === 403) return "OpenAI 凭证无效或无权使用所选图片模型，请检查模型设置。";
  if (status === 429) return "图片模型当前请求较多或额度不足，请稍后重试。";
  return "艺术家小熊暂时无法完成图片生成，请稍后重试。";
}

function logImageGenerationError(error: unknown) {
  const details = error && typeof error === "object" ? error as {
    name?: unknown;
    message?: unknown;
    stack?: unknown;
    status?: unknown;
    code?: unknown;
    type?: unknown;
    param?: unknown;
    request_id?: unknown;
  } : {};
  console.error("[design-image] generation failed", {
    name: String(details.name ?? "UnknownError"),
    message: String(details.message ?? "Unknown image generation failure"),
    stack: typeof details.stack === "string" ? details.stack : undefined,
    status: typeof details.status === "number" ? details.status : undefined,
    code: details.code == null ? undefined : String(details.code),
    type: details.type == null ? undefined : String(details.type),
    param: details.param == null ? undefined : String(details.param),
    requestId: details.request_id == null ? undefined : String(details.request_id),
  });
}

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return errorResponse("项目参数无效。", 400);

  try {
    await requireProjectMember(projectId);
    const { data, error } = await createAdminClient()
      .from("image_generations")
      .select(generationSelect)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(24);

    if (error) return errorResponse("暂时无法读取图片成果。", 500);
    const generations = await Promise.all(((data ?? []) as GenerationRow[]).map(toSummary));
    return Response.json({ generations }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    return errorResponse("暂时无法读取图片成果。", 500);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const requestId = body?.requestId;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const size = body?.size;
  const quality = body?.quality;
  const operation: ImageOperation = body?.operation === "edit" ? "edit" : "generate";
  const sourceKind = body?.sourceKind;
  const sourceId = body?.sourceId;
  const requestedSources = Array.isArray(body?.sources) ? body.sources : sourceKind && sourceId ? [{ kind: sourceKind, id: sourceId }] : [];
  const batchId = body?.batchId;
  const batchIndex = Number.isInteger(body?.batchIndex) ? body.batchIndex : 0;

  if (!isUuid(projectId) || !isUuid(requestId)) return errorResponse("请求参数无效。", 400);
  if (!prompt || prompt.length > 32_000) return errorResponse("请输入不超过 32,000 字的图片描述。", 400);
  if (!isImageSize(size) || !isImageQuality(quality)) return errorResponse("图片尺寸或质量参数无效。", 400);
  if (
    operation === "edit"
    && (requestedSources.length < 1 || requestedSources.length > 5 || requestedSources.some((source: unknown) => {
      if (!source || typeof source !== "object") return true;
      const candidate = source as { kind?: unknown; id?: unknown };
      return !["generation", "project_file", "feishu_drive", "design_asset"].includes(String(candidate.kind)) || !isUuid(candidate.id);
    }))
  ) {
    return errorResponse("请选择一张当前项目中的源图片。", 400);
  }

  let generationId: string | null = null;
  const copiedSourcePaths: string[] = [];
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const admin = createAdminClient();

    const { data: existing, error: existingError } = await admin
      .from("image_generations")
      .select(generationSelect)
      .eq("user_id", user.id)
      .eq("request_id", requestId)
      .maybeSingle();
    if (existingError) return errorResponse("暂时无法确认图片生成状态。", 500);
    if (existing) {
      const summary = await toSummary(existing as GenerationRow);
      if (summary.status === "completed") {
        return Response.json({ generation: summary }, { headers: responseHeaders });
      }
      return errorResponse(
        summary.status === "running" ? "这次图片生成仍在进行，请勿重复提交。" : summary.errorMessage || "这次图片生成未完成，请重新发起。",
        409,
      );
    }

    let modelConfig: Awaited<ReturnType<typeof resolveImageModelConfig>>;
    try {
      modelConfig = await resolveImageModelConfig(user.id);
    } catch {
      return errorResponse("请先在模型设置中配置可用的 OpenAI 凭证。", 409);
    }

    let sources: SourceImage[] = [];
    if (operation === "edit") {
      sources = await Promise.all(requestedSources.map((source: { kind: ImageSourceKind; id: string }) => resolveSourceImage({
        kind: source.kind, id: source.id, projectId, supabase, admin,
      })));
    }
    const primarySource = sources[0] ?? null;

    const thread = await getOrCreateAgentThread(supabase, user.id, projectId, "design");
    const { data: created, error: createError } = await admin
      .from("image_generations")
      .insert({
        request_id: requestId,
        project_id: projectId,
        user_id: user.id,
        thread_id: thread.id,
        operation,
        source_generation_id: primarySource?.kind === "generation" ? primarySource.id : null,
        source_project_file_id: primarySource?.kind === "project_file" ? primarySource.id : null,
        source_feishu_drive_item_id: primarySource?.kind === "feishu_drive" ? primarySource.id : null,
        source_design_asset_id: primarySource?.kind === "design_asset" ? primarySource.id : null,
        source_refs: sources.map((source) => ({ kind: source.kind, id: source.id, name: source.fileName })),
        batch_id: isUuid(batchId) ? batchId : null,
        batch_index: batchIndex >= 0 && batchIndex < 4 ? batchIndex : 0,
        provider: modelConfig.provider,
        model: modelConfig.model,
        prompt,
        size,
        quality,
        output_format: "png",
        status: "running",
      })
      .select("id")
      .single();
    if (createError || !created) return errorResponse("暂时无法创建图片生成任务。", 500);
    generationId = created.id;

    let stableSourcePath: string | null = null;
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      if (source.kind === "generation") {
        if (index === 0) stableSourcePath = source.storagePath;
        continue;
      }
      const copiedSourcePath = `${projectId}/${generationId}/source-${index}.${sourceExtension(source.mimeType)}`;
      const sourceBytes = source.bytes.buffer.slice(source.bytes.byteOffset, source.bytes.byteOffset + source.bytes.byteLength) as ArrayBuffer;
      const { error: sourceUploadError } = await admin.storage.from(bucket).upload(copiedSourcePath, sourceBytes, { contentType: source.mimeType, upsert: false });
      if (sourceUploadError) throw new Error("Image edit source snapshot failed.");
      copiedSourcePaths.push(copiedSourcePath);
      if (index === 0) stableSourcePath = copiedSourcePath;
    }

    if (primarySource && stableSourcePath) {
      const { error: sourceRecordError } = await admin
        .from("image_generations")
        .update({ source_storage_path: stableSourcePath, source_mime_type: primarySource.mimeType })
        .eq("id", generationId);
      if (sourceRecordError) throw new Error("Image edit source record failed.");
    }

    const toolInput = { userId: user.id, projectId, prompt, size, quality, modelConfig };
    const generated = sources.length > 0
      ? await editImage({ ...toolInput, sources })
      : await generateImage(toolInput);
    const storagePath = `${projectId}/${generationId}/output.png`;
    const bytes = generated.bytes.buffer.slice(
      generated.bytes.byteOffset,
      generated.bytes.byteOffset + generated.bytes.byteLength,
    ) as ArrayBuffer;
    const { error: uploadError } = await admin.storage.from(bucket).upload(storagePath, bytes, {
      contentType: generated.mimeType,
      upsert: false,
    });
    if (uploadError) throw new Error("Generated image storage failed.");

    const completedAt = new Date().toISOString();
    const { data: completed, error: completeError } = await admin
      .from("image_generations")
      .update({
        model: generated.model,
        storage_path: storagePath,
        mime_type: generated.mimeType,
        status: "completed",
        completed_at: completedAt,
        error_message: null,
      })
      .eq("id", generationId)
      .select(generationSelect)
      .single();
    if (completeError || !completed) {
      await admin.storage.from(bucket).remove([storagePath]);
      throw new Error("Generated image completion failed.");
    }

    await admin.from("project_activities").insert({
      project_id: projectId,
      user_id: user.id,
      event_type: "design_image_generated",
      actor_type: "agent",
      actor: "艺术家小熊",
      summary: `${operation === "edit" ? "艺术家小熊根据参考图完成图片修改" : "艺术家小熊完成图片生成"}：${prompt.replace(/\s+/g, " ").slice(0, 80)}`,
      related_entity_id: generationId,
      details: {
        operation,
        size,
        quality,
        source_count: sources.length,
        batch_id: isUuid(batchId) ? batchId : null,
      },
    });

    return Response.json(
      { generation: await toSummary(completed as GenerationRow) },
      { status: 201, headers: responseHeaders },
    );
  } catch (error) {
    if (error instanceof ProjectAccessError) return errorResponse(error.message, error.status);
    if (error instanceof ImageSourceError) return errorResponse(error.message, error.status);
    logImageGenerationError(error);
    const message = safeFailureMessage(error);
    if (copiedSourcePaths.length > 0) {
      await createAdminClient().storage.from(bucket).remove(copiedSourcePaths);
    }
    if (generationId) {
      await createAdminClient()
        .from("image_generations")
        .update({
          status: "failed",
          error_message: message,
          ...(copiedSourcePaths.length > 0 ? { source_storage_path: null, source_mime_type: null } : {}),
        })
        .eq("id", generationId);
    }
    return errorResponse(message, 502);
  }
}
