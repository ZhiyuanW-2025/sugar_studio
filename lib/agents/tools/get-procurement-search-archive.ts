import "server-only";

import { tool } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const inputSchema = z.object({
  search_run_id: z.string().uuid().nullable().optional().describe("已知的搜索批次 ID；用户说‘刚才’时留空，系统会读取当前项目最新批次。"),
  query: z.string().max(200).nullable().optional().describe("用户引用更早的品类或需求时，用关键词匹配历史搜索条件。"),
  result_limit: z.number().int().min(1).max(50).default(20),
});

export function createGetProcurementSearchArchiveTool(access: {
  supabase: SupabaseClient;
  projectId: string;
  onExecute?: () => void;
}) {
  return tool({
    name: "get_procurement_search_archive",
    description: "读取当前项目已经永久归档的 1688 选品批次和结构化商品。用户引用‘刚才/之前的商品’时必须用它精确定位，禁止重新搜索代替读取。",
    parameters: inputSchema,
    errorFunction: null,
    async execute({ search_run_id, query: searchQuery, result_limit }) {
      let query = access.supabase.from("procurement_search_runs")
        .select("id,requirement,created_at,result_count")
        .eq("project_id", access.projectId);
      const archiveKeyword = searchQuery?.trim().replace(/[%_]/g, "");
      query = search_run_id
        ? query.eq("id", search_run_id)
        : (archiveKeyword ? query.ilike("requirement", `%${archiveKeyword}%`) : query)
          .order("created_at", { ascending: false }).limit(1);
      const { data: run, error } = await query.maybeSingle();
      if (error) throw new Error("Procurement search archive read failed.");
      if (!run) return { found: false, message: "当前项目没有可用的历史选品批次。" };
      const { data: products, error: resultError } = await access.supabase.from("procurement_search_results")
        .select("id,rank,item_id,sku_id,title,image_url,unit_price,total_price,min_order_qty,sales_count,supplier_name,seller_login_id,supplier_years,supplier_city,factory_tag,source_factory_info,delivery_timeliness,customization,service_performance,customer_star,recommendation_reasons,requirement_match,product_url,candidate_id")
        .eq("search_run_id", run.id).order("rank").limit(result_limit);
      if (resultError) throw new Error("Procurement search archive products read failed.");
      access.onExecute?.();
      return { found: true, search_run: run, products: products ?? [] };
    },
  });
}
