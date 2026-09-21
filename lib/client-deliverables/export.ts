import "server-only";

import fontkit from "@pdf-lib/fontkit";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, rgb } from "pdf-lib";
import PptxGenJS from "pptxgenjs";

type ExportInput = {
  title: string;
  projectName: string;
  content: string;
};

type ContentBlock = { kind: "heading" | "paragraph" | "bullet"; text: string; level: number };

function parseBlocks(content: string): ContentBlock[] {
  return content.split(/\r?\n/).map((line) => {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) return { kind: "heading" as const, text: heading[2].trim(), level: heading[1].length };
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
    if (bullet) return { kind: "bullet" as const, text: bullet[1].trim(), level: 1 };
    return { kind: "paragraph" as const, text: line.trim(), level: 1 };
  }).filter((block) => block.text);
}

export async function exportDocx(input: ExportInput) {
  const children = [
    new Paragraph({ text: input.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: `项目：${input.projectName}`, color: "6B746E", size: 20 })], spacing: { after: 320 } }),
    ...parseBlocks(input.content).map((block) => {
      if (block.kind === "heading") {
        return new Paragraph({ text: block.text, heading: block.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2 });
      }
      return new Paragraph({ text: block.text, bullet: block.kind === "bullet" ? { level: 0 } : undefined, spacing: { after: 140 }, style: "Normal" });
    }),
  ];
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children }] })) as Uint8Array);
}

function wrapText(text: string, maxCharacters = 42) {
  const lines: string[] = [];
  let current = "";
  for (const character of text) {
    current += character;
    if (current.length >= maxCharacters || character === "\n") {
      lines.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.filter(Boolean);
}

export async function exportPdf(input: ExportInput, fontBytes: ArrayBuffer) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 54;
  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;
  const addLine = (text: string, size: number, color = rgb(0.2, 0.22, 0.2), gap = 8) => {
    if (y < margin + size * 2) { page = pdf.addPage(pageSize); y = pageSize[1] - margin; }
    page.drawText(text, { x: margin, y, size, font, color });
    y -= size + gap;
  };
  addLine(input.title, 22, rgb(0.12, 0.18, 0.15), 12);
  addLine(`项目：${input.projectName}`, 10, rgb(0.42, 0.46, 0.43), 24);
  for (const block of parseBlocks(input.content)) {
    const size = block.kind === "heading" ? (block.level === 1 ? 15 : 13) : 10.5;
    const prefix = block.kind === "bullet" ? "• " : "";
    if (block.kind === "heading") y -= 6;
    for (const line of wrapText(`${prefix}${block.text}`, block.kind === "heading" ? 30 : 43)) addLine(line, size, undefined, 6);
    y -= block.kind === "heading" ? 5 : 3;
  }
  return pdf.save();
}

function slideText(content: string) {
  const sections: { title: string; body: string[] }[] = [];
  let current = { title: "内容概览", body: [] as string[] };
  for (const block of parseBlocks(content)) {
    if (block.kind === "heading") {
      if (current.body.length) sections.push(current);
      current = { title: block.text, body: [] };
    } else current.body.push(`${block.kind === "bullet" ? "• " : ""}${block.text}`);
  }
  if (current.body.length || sections.length === 0) sections.push(current);
  return sections;
}

export async function exportPptx(input: ExportInput) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Sugar Agent";
  pptx.subject = input.projectName;
  pptx.title = input.title;
  pptx.theme = { headFontFace: "Noto Sans SC", bodyFontFace: "Noto Sans SC" };
  const cover = pptx.addSlide();
  cover.background = { color: "F7F8F5" };
  cover.addText(input.title, { x: 0.8, y: 2.1, w: 11.6, h: 0.8, fontFace: "Noto Sans SC", fontSize: 28, bold: true, color: "23372E", margin: 0 });
  cover.addText(`项目：${input.projectName}`, { x: 0.8, y: 3.05, w: 11.6, h: 0.35, fontFace: "Noto Sans SC", fontSize: 11, color: "758078", margin: 0 });
  for (const section of slideText(input.content)) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText(section.title, { x: 0.7, y: 0.55, w: 11.9, h: 0.55, fontFace: "Noto Sans SC", fontSize: 22, bold: true, color: "23372E", margin: 0 });
    slide.addShape(pptx.ShapeType.line, { x: 0.7, y: 1.25, w: 11.9, h: 0, line: { color: "DDE4DF", width: 1 } });
    slide.addText(section.body.join("\n"), { x: 0.85, y: 1.55, w: 11.3, h: 5.2, fontFace: "Noto Sans SC", fontSize: 16, color: "3F4742", breakLine: false, valign: "top", margin: 0.05, paraSpaceAfter: 12, fit: "shrink" });
  }
  return new Uint8Array(await pptx.write({ outputType: "arraybuffer" }) as ArrayBuffer);
}
