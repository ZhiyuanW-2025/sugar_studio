import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401, headers });
  const { data, error } = await supabase.from("client_material_templates")
    .select("id, name, deliverable_type, description, outline").order("name");
  if (error) return Response.json({ error: "材料模板加载失败。" }, { status: 500, headers });
  return Response.json({ templates: (data ?? []).map((item) => ({ id: item.id, name: item.name, deliverableType: item.deliverable_type, description: item.description, outline: item.outline })) }, { headers });
}
