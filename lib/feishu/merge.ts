export type MergeTextBlock = { blockId: string; text: string };

export type FeishuBlockMergeDecision =
  | { kind: "safe"; blockId: string }
  | { kind: "conflict"; blockId: string; liveText: string | null };

export function decideFeishuTextBlockMerge(input: {
  blockId: string;
  baseText: string;
  liveBlocks: MergeTextBlock[];
}): FeishuBlockMergeDecision {
  const live = input.liveBlocks.find((block) => block.blockId === input.blockId);
  if (!live || live.text.trim() !== input.baseText.trim()) {
    return { kind: "conflict", blockId: input.blockId, liveText: live?.text ?? null };
  }
  return { kind: "safe", blockId: input.blockId };
}
