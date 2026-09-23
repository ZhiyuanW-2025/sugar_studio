import "server-only";

import { tool } from "@openai/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export function createUpdateMarketingContentTool(input: { supabase: SupabaseClient; userId: string; projectId: string; marketingContentId: string }) {
  return tool({
    name: "update_marketing_content",
    description: "只更新当前用户已选中的宣传作品。用于保存豆豆对标题、正文、标签、封面文案和图片建议的创建或局部修改；不得更新其他作品。",
    parameters: z.object({
      title: z.string().min(1).max(240).optional(),
      content: z.string().min(1).max(100000).optional(),
      cover_copy: z.string().max(1000).optional(),
      tags: z.array(z.string().max(80)).max(30).optional(),
      image_plan: z.string().max(20000).optional(),
      change_summary: z.string().min(1).max(1000),
    }),
    errorFunction: null,
    async execute(values) {
      const updates: Record<string, unknown> = { updated_by: input.userId };
      if (values.title !== undefined) updates.title = values.title.trim();
      if (values.content !== undefined) updates.content = values.content.trim();
      if (values.cover_copy !== undefined) updates.cover_copy = values.cover_copy.trim();
      if (values.tags !== undefined) updates.tags = values.tags.map((item) => item.trim()).filter(Boolean);
      if (values.image_plan !== undefined) updates.image_plan = values.image_plan.trim();
      if (Object.keys(updates).length === 1) return { updated: false, reason: "没有需要修改的作品字段。" };
      const { data, error } = await input.supabase.from("marketing_contents").update(updates)
        .eq("id", input.marketingContentId).eq("project_id", input.projectId)
        .select("id,title,updated_at").maybeSingle();
      if (error || !data) throw new Error("当前宣传作品更新失败，或用户无权访问该作品。");
      return { updated: true, marketing_content_id: data.id, title: data.title, updated_at: data.updated_at, change_summary: values.change_summary };
    },
  });
}
