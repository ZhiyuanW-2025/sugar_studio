import "server-only";

import OpenAI from "openai";
import {
  KNOWLEDGE_EMBEDDING_BATCH_SIZE,
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  KNOWLEDGE_EMBEDDING_MODEL,
} from "./config";

export async function createKnowledgeEmbeddings(input: {
  apiKey: string;
  texts: string[];
}): Promise<number[][]> {
  const client = new OpenAI({ apiKey: input.apiKey, maxRetries: 2 });
  const embeddings: number[][] = [];

  for (let offset = 0; offset < input.texts.length; offset += KNOWLEDGE_EMBEDDING_BATCH_SIZE) {
    const batch = input.texts.slice(offset, offset + KNOWLEDGE_EMBEDDING_BATCH_SIZE);
    const response = await client.embeddings.create({
      model: KNOWLEDGE_EMBEDDING_MODEL,
      input: batch,
      encoding_format: "float",
      dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
    });
    const ordered = [...response.data].sort((left, right) => left.index - right.index);
    if (ordered.length !== batch.length || ordered.some((item) => item.embedding.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS)) {
      throw new Error("INVALID_EMBEDDING_RESPONSE");
    }
    embeddings.push(...ordered.map((item) => item.embedding));
  }

  return embeddings;
}

export function toPostgresVector(value: number[]) {
  return `[${value.join(",")}]`;
}
