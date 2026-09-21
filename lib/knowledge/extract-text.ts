import "server-only";

import { strFromU8, unzipSync } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";
import type { ExtractedKnowledgePage } from "./types";

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlText(xml: string, textTagPattern: RegExp) {
  const parts: string[] = [];
  for (const match of xml.matchAll(textTagPattern)) {
    parts.push(decodeXml(match[1] ?? ""));
  }
  return normalizeText(parts.join(" "));
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedKnowledgePage[]> {
  const pdf = await getDocumentProxy(bytes);
  const result = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(result.text) ? result.text : [result.text];
  return pages
    .map((text, index) => ({ pageNumber: index + 1, sectionTitle: null, text: normalizeText(text) }))
    .filter((page) => page.text.length > 0);
}

function extractDocx(bytes: Uint8Array): ExtractedKnowledgePage[] {
  const archive = unzipSync(bytes);
  const document = archive["word/document.xml"];
  if (!document) throw new Error("DOCX_MAIN_DOCUMENT_MISSING");
  const xml = strFromU8(document)
    .replace(/<w:tab\b[^>]*\/>/g, " ")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n");
  const text = xmlText(xml, /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g);
  return text ? [{ pageNumber: null, sectionTitle: null, text }] : [];
}

function extractPptx(bytes: Uint8Array): ExtractedKnowledgePage[] {
  const archive = unzipSync(bytes);
  return Object.keys(archive)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/slide(\d+)/)?.[1] ?? 0);
      const rightNumber = Number(right.match(/slide(\d+)/)?.[1] ?? 0);
      return leftNumber - rightNumber;
    })
    .map((name, index) => ({
      pageNumber: index + 1,
      sectionTitle: `幻灯片 ${index + 1}`,
      text: xmlText(strFromU8(archive[name]), /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g),
    }))
    .filter((page) => page.text.length > 0);
}

function extractXlsx(bytes: Uint8Array): ExtractedKnowledgePage[] {
  const archive = unzipSync(bytes);
  const sharedStringsXml = archive["xl/sharedStrings.xml"]
    ? strFromU8(archive["xl/sharedStrings.xml"])
    : "";
  const sharedStrings = Array.from(sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map(
    (match) => xmlText(match[1] ?? "", /<t\b[^>]*>([\s\S]*?)<\/t>/g),
  );

  return Object.keys(archive)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()
    .map((name, index) => {
      const xml = strFromU8(archive[name]);
      const rows: string[] = [];
      for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = [];
        for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
          const attributes = cell[1] ?? "";
          const body = cell[2] ?? "";
          const inline = xmlText(body, /<t\b[^>]*>([\s\S]*?)<\/t>/g);
          const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
          const value = /\bt="s"/.test(attributes)
            ? sharedStrings[Number(raw)] ?? raw
            : inline || decodeXml(raw);
          if (value) cells.push(value);
        }
        if (cells.length > 0) rows.push(cells.join(" | "));
      }
      return {
        pageNumber: index + 1,
        sectionTitle: `工作表 ${index + 1}`,
        text: normalizeText(rows.join("\n")),
      };
    })
    .filter((page) => page.text.length > 0);
}

export async function extractKnowledgeText(input: {
  bytes: Uint8Array;
  extension: string;
}): Promise<ExtractedKnowledgePage[]> {
  const extension = input.extension.toLowerCase();
  if (extension === "pdf") return extractPdf(input.bytes);
  if (extension === "docx") return extractDocx(input.bytes);
  if (extension === "pptx") return extractPptx(input.bytes);
  if (extension === "xlsx") return extractXlsx(input.bytes);
  if (["txt", "md", "markdown"].includes(extension)) {
    const text = normalizeText(new TextDecoder().decode(input.bytes));
    return text ? [{ pageNumber: null, sectionTitle: null, text }] : [];
  }
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return [];
  throw new Error("UNSUPPORTED_KNOWLEDGE_FILE");
}
