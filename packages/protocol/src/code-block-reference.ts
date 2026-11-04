import { z } from "zod";
import type { CodePreviewLanguage } from "./html-preview.js";

/** Identifies an existing assistant fence; the owning conversation is supplied separately. */
export const codeBlockReferenceSchema = z.string().regex(/^codeblock:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(?:[1-9]\d{0,2}|1000)$/u);
type SourceMessage = { id: string; role: string; status: string; content: string };
export type PreviewCodeBlock = { index: number; code: string; language: CodePreviewLanguage };
export type MessageCodeBlock = PreviewCodeBlock & { sourceRef: string };
const languages: Record<string, CodePreviewLanguage | undefined> = { html: "html", react: "react", jsx: "react", tsx: "react", vue: "vue" };

/** Only complete fences are executable. Track unsupported outer fences as well. */
function scanCodeBlocks(content: string): { blocks: PreviewCodeBlock[]; incomplete: boolean } {
  const blocks: PreviewCodeBlock[] = [];
  let opening: { marker: string; length: number; language: CodePreviewLanguage | undefined; start: number } | undefined;
  const lines = content.replace(/\r\n/gu, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (opening !== undefined) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line)?.[1];
      if (closing?.[0] !== opening.marker || closing.length < opening.length) continue;
      const code = `${lines.slice(opening.start, index).join("\n")}\n`;
      if (opening.language !== undefined && code.trim().length > 0 && blocks.length < 1000) {
        blocks.push({ index: blocks.length + 1, code, language: opening.language });
      }
      opening = undefined;
      continue;
    }
    const fence = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/u.exec(line);
    if (fence === null || (fence[1]![0] === "`" && fence[2]!.includes("`"))) continue;
    const label = fence[2]!.trim().split(/\s/u)[0]?.toLowerCase() ?? "";
    opening = { marker: fence[1]![0]!, length: fence[1]!.length, language: Object.hasOwn(languages, label) ? languages[label] : undefined, start: index + 1 };
  }
  return { blocks, incomplete: opening?.language !== undefined };
}

export function previewCodeBlocks(content: string): PreviewCodeBlock[] { return scanCodeBlocks(content).blocks; }

export function resolveMessageCodeBlock(messages: readonly SourceMessage[], reference: string): MessageCodeBlock | null {
  if (reference !== "latest" && !codeBlockReferenceSchema.safeParse(reference).success) return null;
  const parts = reference.split(":");
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant" || message.status !== "completed" || (reference !== "latest" && message.id !== parts[1])) continue;
    const { blocks, incomplete } = scanCodeBlocks(message.content);
    // A new incomplete source must not silently fall back to an older working preview.
    if (reference === "latest" && incomplete) return null;
    const block = reference === "latest" ? blocks.at(-1) : blocks.find(candidate => candidate.index === Number(parts[2]));
    if (block !== undefined) {
      const sourceRef = `codeblock:${message.id}:${block.index}`;
      if (codeBlockReferenceSchema.safeParse(sourceRef).success) return { ...block, sourceRef };
    }
  }
  return null;
}
