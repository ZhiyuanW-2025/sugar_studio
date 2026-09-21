import { exportDocx, exportPdf, exportPptx } from "../../../../../../lib/client-deliverables/export";
import { isUuid } from "../../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const noStore = { "Cache-Control": "no-store" };

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|\r\n]+/g, "-").slice(0, 100) || "Sugar-Agent-客户材料";
}

export async function GET(request: Request, context: { params: Promise<{ id: string; format: string }> | { id: string; format: string } }) {
  const { id, format } = await context.params;
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!isUuid(id) || !isUuid(projectId) || !["docx", "pdf", "pptx"].includes(format)) {
    return Response.json({ error: "导出参数无效。" }, { status: 400, headers: noStore });
  }
  try {
    const { supabase } = await requireProjectMember(projectId);
    const [{ data: document, error: documentError }, { data: project, error: projectError }] = await Promise.all([
      supabase.from("client_deliverables").select("id, title, current_version_id").eq("id", id).eq("project_id", projectId).maybeSingle(),
      supabase.from("projects").select("name").eq("id", projectId).single(),
    ]);
    if (documentError || projectError || !document || !project) return Response.json({ error: "没有找到该客户材料。" }, { status: 404, headers: noStore });
    const { data: version, error: versionError } = await supabase.from("client_deliverable_versions")
      .select("content").eq("id", document.current_version_id).eq("deliverable_id", document.id).maybeSingle();
    if (versionError || !version) return Response.json({ error: "客户材料内容缺失。" }, { status: 409, headers: noStore });
    const input = { title: document.title, projectName: project.name, content: version.content };
    let bytes: Uint8Array;
    let contentType: string;
    if (format === "docx") {
      bytes = await exportDocx(input);
      contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else if (format === "pptx") {
      bytes = await exportPptx(input);
      contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    } else {
      const fontResponse = await fetch(new URL("/fonts/NotoSansSC-Variable.ttf", request.url), { cache: "no-store" });
      if (!fontResponse.ok) return Response.json({ error: "PDF 中文字体加载失败。" }, { status: 500, headers: noStore });
      bytes = await exportPdf(input, await fontResponse.arrayBuffer());
      contentType = "application/pdf";
    }
    return new Response(bytes as BodyInit, {
      headers: {
        ...noStore,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${safeFileName(document.title)}.${format}`)}`,
      },
    });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
    console.error("[client-deliverable-export]", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown export error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return Response.json({ error: "客户材料导出失败。" }, { status: 500, headers: noStore });
  }
}
