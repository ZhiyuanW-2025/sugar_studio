import { isUuid } from "../../../../lib/model-config/http";
import { NewtonApiError, NewtonClient } from "../../../../lib/newton/server";
import { loadProcurementInquiries } from "../../../../lib/procurement/inquiries";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return fail("项目参数无效。", 400);
  try {
    const { supabase } = await requireProjectMember(projectId);
    return Response.json({ inquiries: await loadProcurementInquiries(supabase, projectId) }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    return fail(error instanceof Error ? error.message : "暂时无法加载询盘记录。", 500);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const requestId = body?.requestId;
  const candidateIds = Array.isArray(body?.candidateIds) ? [...new Set(body.candidateIds.filter(isUuid))] : [];
  const requirement = typeof body?.requirement === "string" ? body.requirement.trim() : "";
  const questions = Array.isArray(body?.questions)
    ? body.questions.map((item: unknown) => typeof item === "string" ? item.trim() : "").filter(Boolean).slice(0, 12)
    : [];
  const mode = body?.mode === "single_round" ? "single_round" : "multi_round";
  const timeoutMinutes = Number(body?.timeoutMinutes);
  if (!isUuid(projectId) || !isUuid(requestId) || body?.confirmed !== true || candidateIds.length < 1 || candidateIds.length > 10
    || !requirement || requirement.length > 5000 || questions.length < 1 || !Number.isFinite(timeoutMinutes) || timeoutMinutes < 5 || timeoutMinutes > 120) {
    return fail("询盘参数无效，请检查候选、需求和问题。", 400);
  }

  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const admin = createAdminClient();
    const { data: existing } = await admin.from("procurement_inquiries").select("id").eq("requested_by", user.id).eq("request_id", requestId).maybeSingle();
    if (existing) return fail("这次询盘已经提交，请勿重复发送。", 409);
    const { data: candidates, error: candidateError } = await supabase.from("project_procurement_candidates")
      .select("id, item_id, sku_id, title, image_url, product_url, supplier_name, seller_login_id")
      .eq("project_id", projectId).in("id", candidateIds);
    if (candidateError || !candidates || candidates.length !== candidateIds.length || candidates.some((item) => !item.product_url)) {
      return fail("部分采购候选不存在或缺少 1688 商品链接。", 400);
    }

    const { data: inquiry, error: insertError } = await admin.from("procurement_inquiries").insert({
      project_id: projectId, requested_by: user.id, request_id: requestId, status: "creating",
      conversation_mode: mode, requirement, questions, timeout_minutes: timeoutMinutes, supplier_count: candidates.length,
    }).select("id").single();
    if (insertError || !inquiry) return fail("暂时无法创建询盘记录。", 500);
    const ordered = candidateIds.map((id) => candidates.find((candidate) => candidate.id === id)).filter(Boolean) as typeof candidates;
    const { error: targetsError } = await admin.from("procurement_inquiry_targets").insert(ordered.map((candidate, index) => ({
      inquiry_id: inquiry.id, candidate_id: candidate.id, ordinal: index + 1, item_id: candidate.item_id,
      sku_id: candidate.sku_id, title: candidate.title, image_url: candidate.image_url, product_url: candidate.product_url,
      supplier_name: candidate.supplier_name, seller_login_id: candidate.seller_login_id,
    })));
    if (targetsError) {
      await admin.from("procurement_inquiries").delete().eq("id", inquiry.id);
      return fail("暂时无法保存询盘商家列表。", 500);
    }

    try {
      const created = await new NewtonClient().createProductInquiryTask({
        products: ordered.map((candidate) => ({ itemId: candidate.item_id, productUrl: candidate.product_url!, title: candidate.title })),
        requirement, questions, mode, timeoutMinutes,
      });
      await admin.from("procurement_inquiries").update({
        newton_task_id: created.taskId, newton_session_id: created.sessionId, status: "sent", last_error: null,
      }).eq("id", inquiry.id);
      await admin.from("procurement_inquiry_targets").update({ status: "sent" }).eq("inquiry_id", inquiry.id);
      await admin.from("project_activities").insert({
        project_id: projectId, user_id: user.id, event_type: "procurement_inquiry_sent", actor_type: "user",
        actor: user.email ?? "项目成员", summary: `通过拉夫向 ${candidates.length} 家商家发送了采购询盘`, related_entity_id: inquiry.id,
      });
      return Response.json({ created: true, inquiryId: inquiry.id }, { status: 201, headers });
    } catch (error) {
      const ambiguous = error instanceof NewtonApiError && error.retryable;
      await admin.from("procurement_inquiries").update({
        status: ambiguous ? "creation_unknown" : "failed",
        last_error: ambiguous ? "连接中断，无法确认询盘是否已经发出。请勿重复提交，稍后同步状态。" : "1688 未能创建询盘任务。",
      }).eq("id", inquiry.id);
      return fail(ambiguous ? "连接中断，暂时无法确认询盘是否发出；请不要重复发送。" : "1688 暂时无法发送询盘，请稍后重试。", 502);
    }
  } catch (error) {
    if (error instanceof ProjectAccessError) return fail(error.message, error.status);
    return fail("暂时无法发送询盘，请稍后重试。", 500);
  }
}
