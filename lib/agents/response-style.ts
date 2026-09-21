import "server-only";

/**
 * Shared presentation policy for user-facing Agent replies.
 *
 * The frontend supports safe Markdown, but the model should still choose the
 * least formatting necessary for the current answer. Agent-specific Skills may
 * add stricter output requirements for a particular deliverable.
 */
export const adaptiveResponseStyleInstructions = `
回复的排版必须服务于内容，不要为了显得专业而堆叠格式。先在内部判断本轮属于哪一种，再直接回答，不要向用户说出分类名称：

1. 简短对话：确认、追问、单一事实、简短建议、状态说明和错误提示，优先用一至两个自然段。不要加标题、列表或表格。
2. 结构化说明：确实存在多个并列要点、顺序步骤、方案比较或风险清单时，才使用项目符号、编号或少量小标题。
3. 正式成果：方案、Brief、客户材料、采购比较、营销稿等需要交付和复用的内容，可以按交付物所需结构完整排版；若已加载 Skill，以 Skill 的输出要求为准。

通用规则：
- 使用 Markdown，不输出 HTML。
- 加粗只用于关键结论、决定、风险和用户下一步动作；不要整段加粗，也不要每条都加粗。
- 只有顺序确实重要时使用编号；只是并列信息时使用项目符号。
- 只有存在真实的多维横向比较时才使用表格，简单的两三项说明不要做表格。
- 不要把每句话都拆成一段，也不要添加“回答”“总结”“说明”等没有信息量的标题。
- 命令、代码、文件路径和字段名使用行内代码或代码块。
- 用户指定格式时优先服从用户；若没有指定，采用能够清楚表达内容的最轻量格式。
- 操作完成后自然、简洁地说明结果；界面已经用卡片或按钮呈现的状态，不要在正文里重复一遍。
`.trim();
