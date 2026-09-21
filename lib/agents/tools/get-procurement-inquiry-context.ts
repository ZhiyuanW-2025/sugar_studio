import "server-only";

import { tool } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export function createGetProcurementInquiryContextTool(access: {
  supabase: SupabaseClient;
  projectId: string;
  onExecute?: () => void;
}) {
  return tool({
    name: "get_procurement_inquiry_context",
    description: "读取用户引用的单个厂家询价记录、结果摘要和完整聊天。只能读取当前项目；讨论下一轮询价前必须先调用。",
    parameters: z.object({
      inquiry_target_id: z.string().uuid().describe("界面引用内容中的厂家询价记录 ID。"),
    }),
    errorFunction: null,
    async execute({ inquiry_target_id }) {
      const { data, error } = await access.supabase.from("procurement_inquiry_targets")
        .select("id,item_id,title,product_url,supplier_name,seller_login_id,status,latest_summary,shop_url,procurement_inquiries!inner(id,project_id,requirement,questions,status,created_at),procurement_inquiry_messages(id,sender,content,sent_at,created_at)")
        .eq("id", inquiry_target_id)
        .eq("procurement_inquiries.project_id", access.projectId)
        .order("sent_at", { referencedTable: "procurement_inquiry_messages", ascending: true })
        .maybeSingle();
      if (error || !data) throw new Error("The referenced supplier inquiry is unavailable in this project.");
      access.onExecute?.();
      return {
        inquiry_target_id: data.id,
        supplier_name: data.supplier_name,
        seller_login_id: data.seller_login_id,
        item_id: data.item_id,
        product_title: data.title,
        product_url: data.product_url,
        status: data.status,
        latest_summary: data.latest_summary,
        inquiry: data.procurement_inquiries,
        messages: data.procurement_inquiry_messages ?? [],
      };
    },
  });
}
