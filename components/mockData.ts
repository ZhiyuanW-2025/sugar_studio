import type { AgentId, Project } from "./types";

export const projects: Project[] = [
  {
    id: "wutong",
    name: "梧桐无同",
    short: "梧",
    focus: "Moon Moi 任务机制优化",
    module: "Moon Moi",
    plannerMessages: [
      {
        id: "p1",
        role: "user",
        body: "Moon Moi 这个任务还是有点复杂，我希望玩家不要在那里停留太久。",
      },
      {
        id: "p2",
        role: "agent",
        body: "可以。我建议把原来的两步观察任务改成一次视觉匹配。玩家只需要找到门头中的目标图形，再使用透明卡片进行叠加确认。这样可以把完成时间控制在 3–5 分钟，同时保留观察城市细节的体验。",
      },
      {
        id: "p3",
        role: "user",
        body: "可以，就按这个。其他点位先不要动。",
      },
      {
        id: "p4",
        role: "agent",
        body: "好的。我已经整理好本次修改：只调整 Moon Moi 的任务机制，其余内容保持当前方案不变。",
      },
    ],
    knowledge: [
      "终点奖励：拍立得 + 餐食",
      "AI 插画流程已取消",
      "Moon Moi：单步视觉匹配",
      "当前项目阶段：制作准备",
    ],
    files: [
      { name: "梧桐无同策划案.pdf", meta: "PDF · 8.4 MB" },
      { name: "Hilton Brief.pdf", meta: "PDF · 2.1 MB" },
      { name: "路线图.png", meta: "PNG · 4.7 MB" },
      { name: "视觉规范.pdf", meta: "PDF · 12.3 MB" },
      { name: "Moon Moi 参考图.jpg", meta: "JPG · 3.2 MB" },
    ],
  },
  {
    id: "pearl",
    name: "东方明珠城市游戏",
    short: "东",
    focus: "夜间路线节奏确认",
    module: "夜游路线",
    plannerMessages: [
      {
        id: "d1",
        role: "user",
        body: "夜间路线的第三站和第四站间隔太长，需要一个轻量过渡。",
      },
      {
        id: "d2",
        role: "agent",
        body: "建议加入一段不要求停留的声音线索。玩家在步行途中收听 90 秒城市广播，并从中获得下一站关键词，不改变整体路线。",
      },
      {
        id: "d3",
        role: "user",
        body: "可以，先按这个方向整理。",
      },
      {
        id: "d4",
        role: "agent",
        body: "已整理为过渡任务：保留既有点位，在步行段加入 90 秒声音线索，并将关键词带入第四站。",
      },
    ],
    knowledge: [
      "核心体验：城市夜游",
      "路线总时长：90 分钟",
      "过渡段采用声音线索",
      "当前项目阶段：体验测试",
    ],
    files: [
      { name: "城市游戏策划案.pdf", meta: "PDF · 6.1 MB" },
      { name: "夜游路线-v3.png", meta: "PNG · 5.5 MB" },
      { name: "音频脚本.docx", meta: "DOCX · 680 KB" },
    ],
  },
  {
    id: "polis",
    name: "PolisSH S5",
    short: "P",
    focus: "第五季参与机制梳理",
    module: "S5 参与流程",
    plannerMessages: [
      {
        id: "s1",
        role: "user",
        body: "S5 的报名说明还是太长，希望第一次来的参与者也能快速理解。",
      },
      {
        id: "s2",
        role: "agent",
        body: "可以把报名说明重组为三个决策点：选择场次、确认协作角色、提交联系方式。其余背景信息放入可展开说明。",
      },
      {
        id: "s3",
        role: "user",
        body: "先用这个结构，不改报名字段。",
      },
      {
        id: "s4",
        role: "agent",
        body: "明白。本次只调整信息层级和步骤表达，保留全部现有报名字段。",
      },
    ],
    knowledge: [
      "第五季主题：协作中的城市",
      "报名字段保持不变",
      "报名流程重组为三步",
      "当前项目阶段：公开招募前",
    ],
    files: [
      { name: "PolisSH-S5-Brief.pdf", meta: "PDF · 3.9 MB" },
      { name: "报名流程.fig", meta: "FIG · 9.2 MB" },
      { name: "参与者 FAQ.docx", meta: "DOCX · 420 KB" },
    ],
  },
];

export const agentMeta: Record<
  AgentId,
  { name: string; initials: string; description: string }
> = {
  planner: {
    name: "策划 Agent",
    initials: "策",
    description: "负责活动概念、机制与体验设计",
  },
  coder: {
    name: "代码 Agent",
    initials: "代",
    description: "负责产品和代码执行",
  },
  designer: {
    name: "美工 Agent",
    initials: "美",
    description: "负责视觉概念、物料与图片修改",
  },
};

export const codeTask = (project: string) => `任务：调整 Moon Moi 任务流程

根据刚刚确认的策划：

1. 将原来的两步观察任务调整为单步视觉匹配
2. 玩家通过透明卡片完成视觉叠加确认
3. 完成时间目标控制在 3–5 分钟
4. 其他任务和页面保持不变
5. 不改变现有整体视觉风格

相关项目：
${project}

相关模块：
Moon Moi`;

export const designTask = `任务：制作 Moon Moi 任务线索卡视觉

视觉要求：
复古但不过度怀旧
保持梧桐区街区质感
与现有项目视觉系统一致

内容：
围绕透明卡片视觉匹配机制设计

用途：
玩家任务物料`;

export const coderReply = `收到。我会按照当前需求处理，计划分为以下步骤：

1. 检查 Moon Moi 当前任务结构
2. 删除第二步观察逻辑
3. 调整为单步视觉匹配
4. 保留现有视觉组件
5. 检查是否影响其他任务流程

当前 Demo 尚未连接 Codex，实际代码执行将在后续版本开放。`;

export const designerReply = `收到。我会先基于当前项目视觉规范整理线索卡方向，重点处理透明叠加关系、街区质感与现场可读性。

当前 Demo 暂未连接图片生成模型，视觉执行将在后续版本开放。`;
