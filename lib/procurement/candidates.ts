import "server-only";

import { createAdminClient } from "../supabase/admin";

type SearchResultRow = {
  id: string;
  item_id: string | null;
  sku_id: string | null;
  title: string;
  image_url: string | null;
  unit_price: number | null;
  total_price: number | null;
  min_order_qty: number | null;
  sales_count: number | null;
  supplier_name: string | null;
  seller_login_id: string | null;
  supplier_years: number | null;
  supplier_city: string | null;
  factory_tag: string | null;
  source_factory_info: string | null;
  delivery_timeliness: string | null;
  customization: string | null;
  service_performance: string | null;
  customer_star: string | null;
  recommendation_reasons: string[];
  requirement_match: string | null;
  product_url: string | null;
};

export async function saveSearchResultsAsCandidates(input: {
  projectId: string;
  userId: string;
  searchResultIds: string[];
  userConfirmation: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("procurement_search_results")
    .select("id,item_id,sku_id,title,image_url,unit_price,total_price,min_order_qty,sales_count,supplier_name,seller_login_id,supplier_years,supplier_city,factory_tag,source_factory_info,delivery_timeliness,customization,service_performance,customer_star,recommendation_reasons,requirement_match,product_url")
    .eq("project_id", input.projectId)
    .in("id", input.searchResultIds);
  const results = (data ?? []) as SearchResultRow[];
  if (error || results.length !== input.searchResultIds.length) throw new Error("Some procurement search results are unavailable.");
  if (results.some((item) => !item.item_id || !item.product_url)) throw new Error("Some procurement results cannot be added because their 1688 identity is incomplete.");

  const rows = results.map((item) => ({
    project_id: input.projectId,
    added_by: input.userId,
    item_id: item.item_id!,
    sku_id: item.sku_id,
    title: item.title,
    image_url: item.image_url,
    unit_price: item.unit_price,
    total_price: item.total_price,
    min_order_qty: item.min_order_qty,
    sales_count: item.sales_count,
    supplier_name: item.supplier_name,
    seller_login_id: item.seller_login_id,
    supplier_years: item.supplier_years,
    supplier_city: item.supplier_city,
    factory_tag: item.factory_tag,
    source_factory_info: item.source_factory_info,
    delivery_timeliness: item.delivery_timeliness,
    customization: item.customization,
    service_performance: item.service_performance,
    customer_star: item.customer_star,
    recommendation_reasons: item.recommendation_reasons ?? [],
    requirement_match: item.requirement_match,
    product_url: item.product_url,
    user_confirmation: input.userConfirmation,
  }));
  const { data: candidates, error: candidateError } = await admin.from("project_procurement_candidates")
    .upsert(rows, { onConflict: "project_id,item_id,sku_identity" })
    .select("id,item_id,sku_id,title");
  if (candidateError || !candidates) {
    console.error("[procurement-candidates] save failed", candidateError ? {
      code: candidateError.code,
      message: candidateError.message,
      details: candidateError.details,
      hint: candidateError.hint,
    } : { message: "Database returned no candidate rows." });
    throw new Error("Procurement candidate save failed.");
  }

  for (const result of results) {
    const candidate = candidates.find((item) => item.item_id === result.item_id && (item.sku_id ?? "") === (result.sku_id ?? ""));
    if (candidate) await admin.from("procurement_search_results").update({ candidate_id: candidate.id }).eq("id", result.id);
  }
  return candidates;
}
