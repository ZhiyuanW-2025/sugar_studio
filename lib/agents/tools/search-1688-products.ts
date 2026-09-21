import "server-only";

import { tool } from "@openai/agents";
import { z } from "zod";
import { NewtonClient } from "../../newton/server";
import { archiveProcurementSearch } from "../../procurement/search-archive";

const inputSchema = z.object({
  requirement: z.string().min(4).max(2_000).describe("完整的自然语言采购需求，包含品类、数量、预算、规格和供应商偏好等已知硬条件。"),
});

export function createSearch1688ProductsTool(options: {
  projectId: string;
  userId: string;
  threadId: string | null;
  onExecute?: () => void;
}) {
  return tool({
    name: "search_1688_products",
    description: "在 1688 上创建只读找品任务并返回清洗后的商品与供应商字段。只用于找品和采购分析，绝不询盘、下单或付款。",
    parameters: inputSchema,
    errorFunction: null,
    async execute({ requirement }) {
      const result = await new NewtonClient().searchProducts(requirement);
      const searchRunId = await archiveProcurementSearch({
        projectId: options.projectId,
        userId: options.userId,
        threadId: options.threadId,
        requirement,
        result,
      });
      options.onExecute?.();
      return {
        search_run_id: searchRunId,
        count: result.products.length,
        products: result.products.slice(0, 20),
        archive_status: "全部选品结果已永久保存到当前项目。",
        safety_boundary: "仅找品与采购分析；未询盘、未下单、未付款。",
      };
    },
  });
}
