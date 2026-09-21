export type KnowledgeScope = "company" | "project";
export type KnowledgeDocumentStatus = "pending" | "processing" | "ready" | "failed" | "unsupported";

export type ExtractedKnowledgePage = {
  pageNumber: number | null;
  sectionTitle: string | null;
  text: string;
};

export type KnowledgeChunkDraft = {
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  tokenCount: number;
};

export type KnowledgeSearchResult = {
  chunkId: string;
  documentId: string;
  scope: KnowledgeScope;
  fileId: string;
  fileName: string;
  content: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  score: number;
  sourceProvider: "upload" | "feishu" | "feishu_drive";
  sourceUrl: string | null;
  userDescription: string;
  agentSummary: string;
};
