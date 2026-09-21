import { createAdminClient } from "../../../../../../lib/supabase/admin";
import { isUuid } from "../../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(id) || !isUuid(projectId)) return Response.json({ error: "连接参数无效。" }, { status: 400, headers });
  try {
    const { supabase } = await requireProjectMember(projectId);
    const { data: scope } = await supabase.from("feishu_drive_scopes").select("id")
      .eq("id", id).eq("project_id", projectId).eq("enabled", true).maybeSingle();
    if (!scope) return Response.json({ error: "没有找到可管理的项目云盘。" }, { status: 404, headers });
    const { error } = await createAdminClient().from("feishu_drive_scopes").update({ enabled: false }).eq("id", id);
    if (error) throw new Error("FEISHU_DRIVE_SCOPE_DISABLE_FAILED");
    return Response.json({ disabled: true }, { headers });
  } catch (error) {
    const status = error instanceof ProjectAccessError ? error.status : 500;
    const message = error instanceof ProjectAccessError ? error.message : "暂时无法停止云盘同步。";
    return Response.json({ error: message }, { status, headers });
  }
}
