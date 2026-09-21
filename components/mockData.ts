import type { AgentId } from "./types";

export const agentMeta: Record<
  AgentId,
  { name: string; initials: string; description: string }
> = {
  planner: {
    name: "制作人小花",
    initials: "花",
    description: "主 Agent · 推进项目、管理知识与协调执行",
  },
  coder: {
    name: "工程师牛牛",
    initials: "牛",
    description: "连接 Codex，讨论并执行工程任务",
  },
  designer: {
    name: "艺术家小熊",
    initials: "熊",
    description: "负责视觉方向与执行方案",
  },
  client: {
    name: "客户伙伴小雪",
    initials: "雪",
    description: "负责 B 端客户材料与沟通草稿",
  },
  buyer: {
    name: "金牌买手拉夫",
    initials: "拉",
    description: "负责 1688 找品、供应商筛选与采购分析",
  },
  marketing: {
    name: "宣传委员豆豆",
    initials: "豆",
    description: "负责小红书与微信公众号营销图文内容",
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
