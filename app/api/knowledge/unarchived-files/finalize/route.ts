import { createClient } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "请先登录后继续。" }, { status: 401 });
  const { data, error } = await supabase.rpc("finalize_staged_files");
  if (error) return Response.json({ error: "暂时无法整理未归档文件。" }, { status: 500 });
  return Response.json({ count: data ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
