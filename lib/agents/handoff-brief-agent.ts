import "server-only";

import {
  Agent,
  generateTraceId,
  getGlobalTraceProvider,
  MemorySession,
  OpenAIProvider,
  Runner,
  type AgentInputItem,
} from "@openai/agents";
import {
  technicalBriefSchema,
  visualBriefSchema,
  type HandoffBrief,
} from "../handoffs/briefs";
import type { StoredMessage } from "./thread-service";

type Input = {
  targetAgent: "coding" | "design";
  history: Pick<StoredMessage, "role" | "content">[];
  model: string;
  apiKey: string;
  planningInstructions: string;
  projectName: string;
  sourcePlanVersion: string | null;
};

function toInputItems(history: Input["history"]): AgentInputItem[] {
  return history.map(({ role, content }) => {
    if (role === "user") return { role: "user", content: [{ type: "input_text", text: content }] };
    if (role === "assistant") {
      return {
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: content }],
      };
    }
    return { role: "system", content };
  });
}

export async function runHandoffBriefAgent(input: Input): Promise<{
  brief: HandoffBrief;
  traceId: string;
}> {
  const traceId = generateTraceId();
  const provider = new OpenAIProvider({ apiKey: input.apiKey, useResponses: true });
  const runner = new Runner({
    model: input.model,
    modelProvider: provider,
    workflowName: input.targetAgent === "coding"
      ? "Sugar Agent · Engineering Task Draft"
      : "Sugar Agent · Visual Brief Draft",
    traceId,
    tracing: { apiKey: input.apiKey },
  });
  const commonInstructions = `${input.planningInstructions}

当前操作只生成一份供用户审核的结构化交接草稿。不得声称已经发送或执行。只能根据对话中已明确的信息填写；信息不足时在对应字段中明确写出“待用户确认”，不得自行编造。related_project 和 source_plan_version 由系统绑定，不得推测或更改。`;
  const technicalInstructions = `${commonInstructions}

输出一份供用户确认后交给牛牛执行的工程任务。字段内容使用自然、易懂的中文，不要添加面向用户的额外产品术语。unchanged_scope 必须具体列出绝对不能修改的内容；acceptance_criteria 必须可验证。requirements、constraints、unchanged_scope、acceptance_criteria 均使用字符串数组。`;
  const visualInstructions = `${commonInstructions}

输出 Visual Brief。把视觉语言落实到构图、材质、字体、色彩、比例和内容层级；required_elements 与 forbidden_elements 必须分开。缺少尺寸或媒介时，在 size_or_medium 明确写“待用户确认”。所有复数字段均使用字符串数组。`;

  try {
    const history = new MemorySession({ initialItems: toInputItems(input.history) });
    if (input.targetAgent === "coding") {
      const agent = new Agent({
        name: "制作人小花 · 工程任务",
        model: input.model,
        instructions: technicalInstructions,
        outputType: technicalBriefSchema,
      });
      const result = await runner.run(agent, "根据当前完整讨论生成一份交给工程师牛牛的工程任务草稿。", {
        maxTurns: 1,
        session: history,
      });
      const brief = technicalBriefSchema.parse({
        ...result.finalOutput,
        related_project: input.projectName,
        source_plan_version: input.sourcePlanVersion,
      });
      await getGlobalTraceProvider().forceFlush();
      return { brief, traceId };
    }

    const agent = new Agent({
      name: "制作人小花 · Visual Brief",
      model: input.model,
      instructions: visualInstructions,
      outputType: visualBriefSchema,
    });
    const result = await runner.run(agent, "根据当前完整讨论生成 Visual Brief 草稿。", {
      maxTurns: 1,
      session: history,
    });
    const brief = visualBriefSchema.parse({
      ...result.finalOutput,
      related_project: input.projectName,
      source_plan_version: input.sourcePlanVersion,
    });
    await getGlobalTraceProvider().forceFlush();
    return { brief, traceId };
  } finally {
    await provider.close();
  }
}
