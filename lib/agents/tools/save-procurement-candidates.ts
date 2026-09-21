import "server-only";

import { tool } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { saveSearchResultsAsCandidates } from "../../procurement/candidates";

const nullableText = z.string().max(2_000).nullable().optional();
const nullableNumber = z.number().finite().nullable().optional();
const candidateSchema = z.object({
  item_id: z.string().min(1).max(100),
  sku_id: z.string().max(100).nullable().optional(),
  title: z.string().min(1).max(500),
  image_url: nullableText,
  unit_price: nullableNumber,
  total_price: nullableNumber,
  min_order_qty: nullableNumber,
  sales_count: nullableNumber,
  supplier_name: z.string().max(500).nullable().optional(),
  seller_login_id: z.string().max(200).nullable().optional(),
  supplier_years: nullableNumber,
  supplier_city: z.string().max(200).nullable().optional(),
  factory_tag: z.string().max(500).nullable().optional(),
  source_factory_info: nullableText,
  delivery_timeliness: nullableText,
  customization: nullableText,
  service_performance: nullableText,
  customer_star: z.string().max(200).nullable().optional(),
  recommendation_reasons: z.array(z.string().max(500)).max(10).default([]),
  requirement_match: nullableText,
  product_url: nullableText,
});

const inputSchema = z.object({
  search_result_ids: z.array(z.string().uuid()).min(1).max(50).optional().describe("优先使用：从 get_procurement_search_archive 返回的准确结果 ID。"),
  candidates: z.array(candidateSchema).min(1).max(8).optional().describe("仅用于本轮刚获得且尚无归档 ID 的兼容输入。"),
  user_confirmation: z.string().min(1).max(500).describe("用户本轮明确要求保存这些候选的原话摘要。"),
}).superRefine((value, context) => {
  if (!value.search_result_ids?.length && !value.candidates?.length) {
    context.addIssue({ code: "custom", message: "search_result_ids or candidates is required" });
  }
});

export function createSaveProcurementCandidatesTool(access: {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  onExecute?: () => void;
}) {
  return tool({
    name: "save_procurement_candidates",
    description: "仅在用户明确说“加入采购候选”或“保存到项目”后保存指定商品。引用历史搜索时必须传 search_result_ids，禁止重新搜索或凭文字重建字段。",
    parameters: inputSchema,
    errorFunction: null,
    async execute({ candidates, search_result_ids, user_confirmation }) {
      const { data: membership, error: membershipError } = await access.supabase.from("project_members")
        .select("id").eq("project_id", access.projectId).eq("user_id", access.userId).maybeSingle();
      if (membershipError || !membership) throw new Error("Project procurement candidate access denied.");

      if (search_result_ids?.length) {
        const saved = await saveSearchResultsAsCandidates({
          projectId: access.projectId,
          userId: access.userId,
          searchResultIds: search_result_ids,
          userConfirmation: user_confirmation,
        });
        access.onExecute?.();
        return { saved: saved.length, candidates: saved };
      }

      const rows = (candidates ?? []).map((candidate) => ({
        project_id: access.projectId,
        added_by: access.userId,
        item_id: candidate.item_id,
        sku_id: candidate.sku_id ?? null,
        title: candidate.title,
        image_url: candidate.image_url ?? null,
        unit_price: candidate.unit_price ?? null,
        total_price: candidate.total_price ?? null,
        min_order_qty: candidate.min_order_qty ?? null,
        sales_count: candidate.sales_count ?? null,
        supplier_name: candidate.supplier_name ?? null,
        seller_login_id: candidate.seller_login_id ?? null,
        supplier_years: candidate.supplier_years ?? null,
        supplier_city: candidate.supplier_city ?? null,
        factory_tag: candidate.factory_tag ?? null,
        source_factory_info: candidate.source_factory_info ?? null,
        delivery_timeliness: candidate.delivery_timeliness ?? null,
        customization: candidate.customization ?? null,
        service_performance: candidate.service_performance ?? null,
        customer_star: candidate.customer_star ?? null,
        recommendation_reasons: candidate.recommendation_reasons,
        requirement_match: candidate.requirement_match ?? null,
        product_url: candidate.product_url ?? null,
        user_confirmation,
      }));
      const { data, error } = await access.supabase.from("project_procurement_candidates")
        .upsert(rows, { onConflict: "project_id,item_id,sku_identity" })
        .select("id,item_id,title");
      if (error) throw new Error("Procurement candidate save failed.");
      access.onExecute?.();
      return { saved: data?.length ?? 0, candidates: data ?? [] };
    },
  });
}
