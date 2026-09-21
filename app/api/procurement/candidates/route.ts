import { isUuid } from "../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../lib/projects/access";
import { saveSearchResultsAsCandidates } from "../../../../lib/procurement/candidates";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(projectId)) return Response.json({ error: "项目参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data, error } = await supabase.from("project_procurement_candidates")
      .select("id, item_id, sku_id, title, image_url, unit_price, min_order_qty, supplier_name, seller_login_id, supplier_years, supplier_city, customization, requirement_match, product_url, created_at")
      .eq("project_id", projectId).order("created_at", { ascending: false }).limit(100);
    if (error) return Response.json({ error: "暂时无法加载采购候选。" }, { status: 500, headers });
    return Response.json({ candidates: data ?? [] }, { headers });
  } catch (error) {
    const status = error instanceof ProjectAccessError ? error.status : 500;
    return Response.json({ error: error instanceof ProjectAccessError ? error.message : "暂时无法加载采购候选。" }, { status, headers });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const searchResultIds = Array.isArray(body?.searchResultIds)
    ? [...new Set((body.searchResultIds as unknown[]).filter((id): id is string => typeof id === "string" && isUuid(id)))]
    : [];
  const userConfirmation = typeof body?.userConfirmation === "string" ? body.userConfirmation.trim() : "";
  if (!isUuid(projectId) || searchResultIds.length < 1 || searchResultIds.length > 50 || !userConfirmation || userConfirmation.length > 500) {
    return Response.json({ error: "采购候选参数无效。" }, { status: 400, headers });
  }
  try {
    const { user } = await requireProjectMember(projectId);
    const candidates = await saveSearchResultsAsCandidates({ projectId, userId: user.id, searchResultIds, userConfirmation });
    return Response.json({ saved: candidates.length, candidates }, { status: 201, headers });
  } catch (error) {
    const status = error instanceof ProjectAccessError ? error.status : 500;
    const message = error instanceof ProjectAccessError ? error.message
      : error instanceof Error && error.message.includes("identity is incomplete") ? "部分商品缺少 1688 商品编号或链接，暂时无法加入候选。"
        : "采购候选保存失败，请稍后重试。";
    return Response.json({ error: message }, { status, headers });
  }
}
