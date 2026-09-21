import "server-only";

import { createHash } from "node:crypto";
import { tool } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { NewtonClient } from "../../newton/server";
import { createAdminClient } from "../../supabase/admin";

function deterministicUuid(source: string) {
  const hex = createHash("sha256").update(source).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function hasExplicitSendAuthorization(message: string) {
  const normalized = message.trim();
  return /(?:确认|现在|直接|可以|开始|让拉夫|让你).{0,18}(?:发送|追问|询价|去问|问商家|联系商家)|(?:就按|就这么|帮我).{0,24}问|(?:发送|追问|询价|去问|问商家|联系商家).{0,18}(?:吧|确认|可以|开始)/i.test(normalized);
}

export function createSendProcurementFollowUpTool(access: {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  threadId: string | null;
  currentUserMessage: string;
  onExecute?: () => void;
}) {
  return tool({
    name: "send_procurement_follow_up",
    description: "在用户本轮明确要求发送/追问/去问商家后，向所引用的单个厂家发送下一轮询价。普通讨论和问题草稿阶段严禁调用。",
    parameters: z.object({
      inquiry_target_id: z.string().uuid(),
      requirement: z.string().min(1).max(5_000).describe("本轮向这家厂商追问的目标和背景。"),
      questions: z.array(z.string().min(1).max(1_000)).min(1).max(12).describe("本轮需要真实发送给商家的问题。"),
    }),
    errorFunction: null,
    async execute({ inquiry_target_id, requirement, questions }) {
      if (!hasExplicitSendAuthorization(access.currentUserMessage)) {
        throw new Error("The user has not explicitly authorized sending this supplier follow-up in the current message.");
      }
      const { data: membership, error: membershipError } = await access.supabase.from("project_members")
        .select("id").eq("project_id", access.projectId).eq("user_id", access.userId).maybeSingle();
      if (membershipError || !membership) throw new Error("Project procurement inquiry access denied.");

      const admin = createAdminClient();
      const { data: target, error: targetError } = await admin.from("procurement_inquiry_targets")
        .select("id,candidate_id,item_id,sku_id,title,image_url,product_url,supplier_name,seller_login_id,procurement_inquiries!inner(project_id)")
        .eq("id", inquiry_target_id)
        .eq("procurement_inquiries.project_id", access.projectId)
        .maybeSingle();
      if (targetError || !target?.product_url) throw new Error("The referenced supplier inquiry is unavailable in this project.");

      const requestId = deterministicUuid(`${access.userId}\n${inquiry_target_id}\n${access.currentUserMessage.trim()}`);
      const { data: existing } = await admin.from("procurement_inquiries")
        .select("id,status").eq("requested_by", access.userId).eq("request_id", requestId).maybeSingle();
      if (existing) return { sent: true, replayed: true, inquiry_id: existing.id, supplier_name: target.supplier_name };

      const { data: inquiry, error: inquiryError } = await admin.from("procurement_inquiries").insert({
        project_id: access.projectId,
        requested_by: access.userId,
        source_thread_id: access.threadId,
        request_id: requestId,
        status: "creating",
        conversation_mode: "multi_round",
        requirement,
        questions,
        timeout_minutes: 30,
        supplier_count: 1,
      }).select("id").single();
      if (inquiryError || !inquiry) throw new Error("Unable to create the supplier follow-up record.");

      const { error: newTargetError } = await admin.from("procurement_inquiry_targets").insert({
        inquiry_id: inquiry.id,
        candidate_id: target.candidate_id,
        ordinal: 1,
        item_id: target.item_id,
        sku_id: target.sku_id,
        title: target.title,
        image_url: target.image_url,
        product_url: target.product_url,
        supplier_name: target.supplier_name,
        seller_login_id: target.seller_login_id,
      });
      if (newTargetError) {
        await admin.from("procurement_inquiries").delete().eq("id", inquiry.id);
        throw new Error("Unable to save the supplier follow-up target.");
      }

      try {
        const created = await new NewtonClient().createProductInquiryTask({
          products: [{ itemId: target.item_id, productUrl: target.product_url, title: target.title }],
          requirement,
          questions,
          mode: "multi_round",
          timeoutMinutes: 30,
        });
        await admin.from("procurement_inquiries").update({
          newton_task_id: created.taskId,
          newton_session_id: created.sessionId,
          status: "sent",
          last_error: null,
        }).eq("id", inquiry.id);
        await admin.from("procurement_inquiry_targets").update({ status: "sent" }).eq("inquiry_id", inquiry.id);
        await admin.from("project_activities").insert({
          project_id: access.projectId,
          user_id: access.userId,
          event_type: "procurement_follow_up_sent",
          actor_type: "agent",
          actor: "金牌买手拉夫",
          summary: `向${target.supplier_name || "1688 商家"}发送了下一轮采购询问`,
          related_entity_id: inquiry.id,
        });
        access.onExecute?.();
        return { sent: true, inquiry_id: inquiry.id, supplier_name: target.supplier_name, questions };
      } catch (error) {
        await admin.from("procurement_inquiries").update({ status: "failed", last_error: "1688 未能创建后续询价任务。" }).eq("id", inquiry.id);
        throw error;
      }
    },
  });
}
