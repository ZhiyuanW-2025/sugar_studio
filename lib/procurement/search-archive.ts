import "server-only";

import { createHash } from "node:crypto";
import type { ProcurementProduct, NewtonSearchResult } from "../newton/server";
import { createAdminClient } from "../supabase/admin";

function identity(product: ProcurementProduct) {
  return createHash("sha256")
    .update(`${product.item_id ?? ""}\n${product.sku_id ?? ""}\n${product.title}\n${product.product_url ?? ""}`)
    .digest("hex");
}

export async function archiveProcurementSearch(input: {
  projectId: string;
  userId: string;
  threadId: string | null;
  requirement: string;
  result: NewtonSearchResult;
}) {
  const admin = createAdminClient();
  const { data: run, error: runError } = await admin.from("procurement_search_runs").insert({
    project_id: input.projectId,
    requested_by: input.userId,
    source_thread_id: input.threadId,
    newton_task_id: input.result.taskId,
    newton_session_id: input.result.sessionId,
    requirement: input.requirement.trim(),
    result_count: input.result.products.length,
  }).select("id").single();
  if (runError || !run) throw new Error("Procurement search archive creation failed.");

  if (input.result.products.length > 0) {
    const { error } = await admin.from("procurement_search_results").insert(input.result.products.map((product, index) => ({
      search_run_id: run.id,
      project_id: input.projectId,
      rank: index + 1,
      item_id: product.item_id,
      sku_id: product.sku_id,
      result_identity: identity(product),
      title: product.title,
      image_url: product.image_url,
      unit_price: product.unit_price,
      total_price: product.total_price,
      min_order_qty: product.min_order_qty,
      sales_count: product.sales_count,
      supplier_name: product.supplier_name,
      seller_login_id: product.seller_login_id,
      supplier_years: product.supplier_years,
      supplier_city: product.supplier_city,
      factory_tag: product.factory_tag,
      source_factory_info: product.source_factory_info,
      delivery_timeliness: product.delivery_timeliness,
      customization: product.customization,
      service_performance: product.service_performance,
      customer_star: product.customer_star,
      recommendation_reasons: product.recommendation_reasons,
      requirement_match: product.requirement_match,
      product_url: product.product_url,
    })));
    if (error) {
      await admin.from("procurement_search_runs").delete().eq("id", run.id);
      throw new Error("Procurement search results archive failed.");
    }
  }
  return run.id as string;
}
