import { getAgentDefinition } from "../../../../../lib/agents/catalog";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { requireWorkspaceMember, WorkspaceAccessError } from "../../../../../lib/workspace/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const allowedTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

function storedAvatarPath(url: string | null) {
  if (!url) return null;
  const marker = "/agent-avatars/";
  const index = url.indexOf(marker);
  if (index < 0) return null;
  try {
    return decodeURIComponent(url.slice(index + marker.length));
  } catch {
    return null;
  }
}

async function contextFor(agentType: string) {
  const definition = getAgentDefinition(agentType);
  if (!definition) return { response: Response.json({ error: "Agent 参数无效。" }, { status: 400, headers }) } as const;
  try {
    const { supabase, user } = await requireWorkspaceMember();
    const { data: agent, error } = await supabase
      .from("agents")
      .select("id, name, avatar_url")
      .eq("agent_type", definition.type)
      .maybeSingle();
    if (error || !agent) return { response: Response.json({ error: "没有找到该 Agent。" }, { status: 404, headers }) } as const;
    const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
    return { agent, definition, user, actor: profile?.display_name?.trim() || "工作室成员" } as const;
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status : 500;
    const message = error instanceof WorkspaceAccessError ? error.message : "暂时无法更新 Agent 头像。";
    return { response: Response.json({ error: message }, { status, headers }) } as const;
  }
}

export async function POST(request: Request, context: { params: Promise<{ agentType: string }> | { agentType: string } }) {
  const { agentType } = await context.params;
  const resolved = await contextFor(agentType);
  if ("response" in resolved) return resolved.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("avatar");
  if (!(file instanceof File) || !allowedTypes.has(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) {
    return Response.json({ error: "请选择 5 MB 以内的 PNG、JPG 或 WebP 图片。" }, { status: 400, headers });
  }

  const admin = createAdminClient();
  const path = `${resolved.definition.type}/avatar-${crypto.randomUUID()}.${allowedTypes.get(file.type)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage.from("agent-avatars").upload(path, bytes, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) return Response.json({ error: "头像上传失败，请稍后重试。" }, { status: 500, headers });

  const { data: publicUrl } = admin.storage.from("agent-avatars").getPublicUrl(path);
  const { error: updateError } = await admin.from("agents").update({ avatar_url: publicUrl.publicUrl }).eq("id", resolved.agent.id);
  if (updateError) {
    await admin.storage.from("agent-avatars").remove([path]);
    return Response.json({ error: "头像保存失败，请稍后重试。" }, { status: 500, headers });
  }

  await admin.from("agent_config_activities").insert({
    agent_id: resolved.agent.id,
    user_id: resolved.user.id,
    event_type: "agent_avatar_changed",
    actor_type: "user",
    actor: resolved.actor,
    summary: `更新了全局${resolved.agent.name}头像`,
    related_entity_id: resolved.agent.id,
  });

  const previousPath = storedAvatarPath(resolved.agent.avatar_url);
  if (previousPath && previousPath !== path) await admin.storage.from("agent-avatars").remove([previousPath]);
  return Response.json({ uploaded: true, avatarUrl: publicUrl.publicUrl }, { headers });
}

export async function DELETE(_request: Request, context: { params: Promise<{ agentType: string }> | { agentType: string } }) {
  const { agentType } = await context.params;
  const resolved = await contextFor(agentType);
  if ("response" in resolved) return resolved.response;

  const admin = createAdminClient();
  const { error } = await admin.from("agents").update({ avatar_url: null }).eq("id", resolved.agent.id);
  if (error) return Response.json({ error: "恢复默认头像失败，请稍后重试。" }, { status: 500, headers });

  await admin.from("agent_config_activities").insert({
    agent_id: resolved.agent.id,
    user_id: resolved.user.id,
    event_type: "agent_avatar_reset",
    actor_type: "user",
    actor: resolved.actor,
    summary: `恢复了全局${resolved.agent.name}默认头像`,
    related_entity_id: resolved.agent.id,
  });

  const previousPath = storedAvatarPath(resolved.agent.avatar_url);
  if (previousPath) await admin.storage.from("agent-avatars").remove([previousPath]);
  return Response.json({ reset: true, avatarUrl: null }, { headers });
}
