import { marketingAgentInstructions, runMarketingAgent } from "../../../../../lib/agents/marketing-agent";
import { resolveAgentInstructions } from "../../../../../lib/agents/prompt-service";
import { resolveActiveAgentSkills } from "../../../../../lib/agents/skill-service";
import { createLoadAgentSkillTool } from "../../../../../lib/agents/tools/load-agent-skill";
import { resolveModelConfig } from "../../../../../lib/model-config/service";
import { isUuid } from "../../../../../lib/model-config/http";
import { ProjectAccessError, requireProjectMember } from "../../../../../lib/projects/access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  const marketingContentId = body?.marketingContentId;
  const suggestion = typeof body?.suggestion === "string" ? body.suggestion.trim() : "";
  const additionalRequest = typeof body?.additionalRequest === "string" ? body.additionalRequest.trim() : "";
  if (!isUuid(projectId) || !isUuid(marketingContentId) || !suggestion || suggestion.length > 8_000 || additionalRequest.length > 4_000) {
    return Response.json({ error: "图片建议参数无效。" }, { status: 400, headers });
  }

  try {
    const { supabase, user } = await requireProjectMember(projectId);
    const { data: work, error: workError } = await supabase.from("marketing_contents")
      .select("id,title,platform,publish_account,content,cover_copy,tags,image_plan")
      .eq("id", marketingContentId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (workError || !work) return Response.json({ error: "没有找到当前宣传作品。" }, { status: 404, headers });

    const model = await resolveModelConfig(user.id, "marketing");
    if (model.provider !== "openai") return Response.json({ error: "豆豆目前只支持 OpenAI 模型。" }, { status: 422, headers });
    const prompt = await resolveAgentInstructions(supabase, "marketing", marketingAgentInstructions);
    const skills = (await resolveActiveAgentSkills(supabase, "marketing")).filter((skill) => skill.slug === "xhs-image-prompt");
    if (skills.length === 0) return Response.json({ error: "xhs_image_prompt Skill 尚未启用。" }, { status: 409, headers });

    const result = await runMarketingAgent({
      message: [
        "请加载 xhs-image-prompt Skill，并只生成一段可复制给艺术家小熊的完整指令。",
        `用户点击的图片建议：\n${suggestion}`,
        additionalRequest ? `用户补充要求：\n${additionalRequest}` : "",
        "不要调用小熊，不要生图，不要发送任务，不要修改宣传作品，不要输出 JSON 或解释性前言。",
      ].filter(Boolean).join("\n\n"),
      history: [],
      model: model.model,
      apiKey: model.apiKey,
      instructions: `${prompt.instructions}\n\n当前宣传作品最新状态：\n标题：${work.title}\n平台：${work.platform}\n发布账号：${work.publish_account || "未设置"}\n正文：\n${work.content}\n封面文案：${work.cover_copy || ""}\n标签：${(work.tags ?? []).join("、")}\n完整图片建议：\n${work.image_plan || ""}`,
      includeFeishuWriteTool: false,
      runtimeTools: [createLoadAgentSkillTool(skills)],
      maxTurns: 4,
      projectContext: { supabase, userId: user.id, projectId },
    });
    return Response.json({ prompt: result.reply }, { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof Error && error.message === "No model configuration is available for this user.") {
      return Response.json({ error: "请先在模型设置中为豆豆配置可用模型。" }, { status: 409, headers });
    }
    return Response.json({ error: "豆豆暂时无法整理图片指令，请稍后重试。" }, { status: 502, headers });
  }
}
