import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

class DispatchConfigurationError extends Error {}

function safeFailure(message: string) {
  return message.replace(/https?:\/\/[^\s]+/g, "[endpoint]").slice(0, 300);
}

async function sendEmail(recipient: string, title: string, content: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.SUGAR_DELIVERY_FROM_EMAIL;
  if (!apiKey || !from) throw new DispatchConfigurationError("邮件发送服务尚未配置。");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [recipient], subject: title, text: content }),
  });
  const result = await response.json().catch(() => null) as { id?: string; message?: string } | null;
  if (!response.ok) throw new Error(`邮件服务返回 ${response.status}${result?.message ? `：${result.message}` : ""}`);
  return result?.id ?? null;
}

async function sendWeCom(recipient: string, title: string, content: string) {
  const webhookUrl = process.env.SUGAR_WECOM_WEBHOOK_URL;
  if (!webhookUrl) throw new DispatchConfigurationError("企业微信发送服务尚未配置。");
  let parsed: URL;
  try { parsed = new URL(webhookUrl); } catch { throw new DispatchConfigurationError("企业微信发送地址配置无效。"); }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("qyapi.weixin.qq.com")) {
    throw new DispatchConfigurationError("企业微信发送地址配置无效。");
  }
  const response = await fetch(parsed, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "markdown", markdown: { content: `**${title}**\n> 发送对象：${recipient}\n\n${content}` } }),
  });
  const result = await response.json().catch(() => null) as { errcode?: number; errmsg?: string } | null;
  if (!response.ok || result?.errcode !== 0) throw new Error(`企业微信服务返回 ${response.status}${result?.errmsg ? `：${result.errmsg}` : ""}`);
  return null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const channel = body?.channel;
  const recipient = typeof body?.recipient === "string" ? body.recipient.trim() : "";
  if (!isUuid(id) || !isUuid(projectId) || !["email", "wecom"].includes(channel) || !recipient || recipient.length > 320
      || (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))) {
    return Response.json({ error: "发送参数无效。" }, { status: 400, headers });
  }
  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { data: document, error: documentError } = await supabase.from("client_deliverables")
      .select("id, title, status, approved_version_id").eq("id", id).eq("project_id", projectId).maybeSingle();
    if (documentError || !document) return Response.json({ error: "没有找到该客户材料。" }, { status: 404, headers });
    if (document.status !== "approved" || !document.approved_version_id) {
      return Response.json({ error: "材料必须先由项目成员明确批准，才能发送。" }, { status: 409, headers });
    }
    const { data: version, error: versionError } = await supabase.from("client_deliverable_versions")
      .select("id, content").eq("id", document.approved_version_id).eq("deliverable_id", document.id).maybeSingle();
    if (versionError || !version) return Response.json({ error: "已批准版本不存在。" }, { status: 409, headers });

    const admin = createAdminClient();
    const { data: dispatch, error: dispatchError } = await admin.from("client_delivery_dispatches").insert({
      deliverable_id: document.id, version_id: version.id, channel, recipient, status: "pending", requested_by: user.id,
    }).select("id").single();
    if (dispatchError || !dispatch) return Response.json({ error: "无法创建受控发送记录。" }, { status: 500, headers });

    try {
      const providerMessageId = channel === "email"
        ? await sendEmail(recipient, document.title, version.content)
        : await sendWeCom(recipient, document.title, version.content);
      await admin.from("client_delivery_dispatches").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: providerMessageId, failure_summary: null }).eq("id", dispatch.id);
      await admin.from("client_deliverables").update({ status: "dispatched" }).eq("id", document.id);
      await admin.from("project_activities").insert({ project_id: projectId, user_id: user.id, event_type: "client_deliverable_dispatched", actor_type: "user", actor: user.email ?? "项目成员", summary: `通过${channel === "email" ? "邮件" : "企业微信"}发送了客户材料：${document.title}`, related_entity_id: document.id });
      return Response.json({ sent: true, dispatchId: dispatch.id }, { headers });
    } catch (error) {
      const message = error instanceof DispatchConfigurationError ? error.message : "外部发送服务暂时不可用。";
      await admin.from("client_delivery_dispatches").update({ status: "failed", failure_summary: safeFailure(message) }).eq("id", dispatch.id);
      return Response.json({ error: message }, { status: error instanceof DispatchConfigurationError ? 503 : 502, headers });
    }
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "客户材料发送失败。" }, { status: 500, headers });
  }
}
