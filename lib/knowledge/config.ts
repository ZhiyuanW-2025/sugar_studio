export const KNOWLEDGE_EMBEDDING_PROVIDER = "openai";
export const KNOWLEDGE_EMBEDDING_MODEL = "text-embedding-3-small";
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536;
export const KNOWLEDGE_PARSER_VERSION = "sugar-knowledge-v2-ocr";
export const KNOWLEDGE_CHUNK_TARGET_CHARACTERS = 1_400;
export const KNOWLEDGE_CHUNK_OVERLAP_CHARACTERS = 220;
export const KNOWLEDGE_EMBEDDING_BATCH_SIZE = 32;
export const KNOWLEDGE_DEFAULT_MATCH_COUNT = 6;
export const KNOWLEDGE_MAX_MATCH_COUNT = 10;

export const indexableKnowledgeExtensions = [
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "txt",
  "md",
  "markdown",
  "png",
  "jpg",
  "jpeg",
  "webp",
] as const;

export function isIndexableKnowledgeExtension(value: string) {
  return (indexableKnowledgeExtensions as readonly string[]).includes(value.toLowerCase());
}
