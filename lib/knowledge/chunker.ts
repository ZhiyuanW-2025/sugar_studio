import {
  KNOWLEDGE_CHUNK_OVERLAP_CHARACTERS,
  KNOWLEDGE_CHUNK_TARGET_CHARACTERS,
} from "./config";
import type { ExtractedKnowledgePage, KnowledgeChunkDraft } from "./types";

function chooseBoundary(text: string, start: number, tentativeEnd: number) {
  if (tentativeEnd >= text.length) return text.length;
  const lowerBound = start + Math.floor(KNOWLEDGE_CHUNK_TARGET_CHARACTERS * 0.55);
  const window = text.slice(lowerBound, tentativeEnd);
  const candidates = [window.lastIndexOf("\n\n"), window.lastIndexOf("。"), window.lastIndexOf("！"), window.lastIndexOf("？"), window.lastIndexOf("\n")];
  const best = Math.max(...candidates);
  return best >= 0 ? lowerBound + best + 1 : tentativeEnd;
}

export function chunkKnowledgePages(pages: ExtractedKnowledgePage[]): KnowledgeChunkDraft[] {
  const chunks: KnowledgeChunkDraft[] = [];

  for (const page of pages) {
    let start = 0;
    while (start < page.text.length) {
      const tentativeEnd = Math.min(start + KNOWLEDGE_CHUNK_TARGET_CHARACTERS, page.text.length);
      const end = chooseBoundary(page.text, start, tentativeEnd);
      const content = page.text.slice(start, end).trim();
      if (content) {
        chunks.push({
          chunkIndex: chunks.length,
          content,
          pageNumber: page.pageNumber,
          sectionTitle: page.sectionTitle,
          tokenCount: Math.ceil(content.length / 3),
        });
      }
      if (end >= page.text.length) break;
      start = Math.max(end - KNOWLEDGE_CHUNK_OVERLAP_CHARACTERS, start + 1);
    }
  }

  return chunks;
}
