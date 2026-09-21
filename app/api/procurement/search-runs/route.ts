import { isUuid } from "../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = 20;
  if (!isUuid(projectId)) return Response.json({ error: "项目参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(projectId);
    const from = (page - 1) * pageSize;
    const { data, error, count } = await supabase.from("procurement_search_runs")
      .select("id,requirement,result_count,created_at,requested_by,procurement_search_results(id,rank,item_id,sku_id,title,image_url,unit_price,total_price,min_order_qty,sales_count,supplier_name,seller_login_id,supplier_years,supplier_city,factory_tag,source_factory_info,delivery_timeliness,customization,service_performance,customer_star,recommendation_reasons,requirement_match,product_url,candidate_id)", { count: "exact" })
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .order("rank", { referencedTable: "procurement_search_results", ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return Response.json({ error: "暂时无法加载选品档案。" }, { status: 500, headers });
    return Response.json({ searchRuns: data ?? [], page, hasMore: from + pageSize < (count ?? 0) }, { headers });
  } catch (error) {
    const status = error instanceof ProjectAccessError ? error.status : 500;
    return Response.json({ error: error instanceof ProjectAccessError ? error.message : "暂时无法加载选品档案。" }, { status, headers });
  }
}
