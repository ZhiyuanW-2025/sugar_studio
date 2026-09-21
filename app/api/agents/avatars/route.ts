import { requireWorkspaceMember, WorkspaceAccessError } from "../../../../lib/workspace/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const { supabase } = await requireWorkspaceMember();
    const { data, error } = await supabase
      .from("agents")
      .select("agent_type, avatar_url")
      .order("agent_type");
    if (error) return Response.json({ error: "暂时无法读取 Agent 头像。" }, { status: 500, headers });
    return Response.json({
      avatars: Object.fromEntries((data ?? []).map((agent) => [agent.agent_type, agent.avatar_url])),
    }, { headers });
  } catch (error) {
    const status = error instanceof WorkspaceAccessError ? error.status : 500;
    const message = error instanceof WorkspaceAccessError ? error.message : "暂时无法读取 Agent 头像。";
    return Response.json({ error: message }, { status, headers });
  }
}
