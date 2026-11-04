import { open } from "node:fs/promises";

import { ToolArgumentsError } from "../model/tool-arguments.js";

const CHUNK_BYTES = 64 * 1024;
const MAX_RANGE_BYTES = 250_000;

/** Scan to the requested lines with bounded memory; never load the whole file to count lines. */
export async function readTextLines(filePath: string, startLine: number, endLine: number, signal: AbortSignal, rangeField: "lineCount" | "endLine" = "endLine") {
  signal.throwIfAborted();
  const file = await open(filePath, "r");
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new ToolArgumentsError("Requested path is not a file.", [
      { code: "invalid_type", path: ["path"], message: "Provide a regular UTF-8 text file path." },
    ]);
    const parts: Buffer[] = [];
    let selectedBytes = 0;
    let line = 1;
    let position = 0;
    let rangeComplete = false;
    let eof = false;
    while (!rangeComplete && !eof) {
      signal.throwIfAborted();
      const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) { eof = true; break; }
      let offset = 0;
      while (offset < bytesRead) {
        const newline = buffer.subarray(0, bytesRead).indexOf(10, offset);
        const stop = newline < 0 ? bytesRead : newline + 1;
        if (line >= startLine) {
          selectedBytes += stop - offset;
          if (selectedBytes > MAX_RANGE_BYTES) throw new ToolArgumentsError("Requested line range is too large.", [
            { code: "too_big", path: [rangeField], message: `Selected lines exceed ${MAX_RANGE_BYTES} bytes. Reduce ${rangeField}; if a single line exceeds this limit, use search_text for a bounded excerpt.` },
          ]);
          parts.push(Buffer.from(buffer.subarray(offset, stop)));
        }
        position += stop - offset;
        offset = stop;
        if (newline >= 0) {
          line += 1;
          if (line > endLine) { rangeComplete = true; break; }
        }
      }
      eof = position >= info.size;
    }
    signal.throwIfAborted();
    if (eof && startLine > line) throw new ToolArgumentsError("startLine is past the end of the file.", [
      { code: "too_big", path: ["startLine"], message: `File has ${line} lines. Choose startLine between 1 and ${line}.` },
    ]);
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts));
      if (content.includes("\0")) throw new Error("NUL byte");
    } catch {
      throw new ToolArgumentsError("Requested range is not UTF-8 text.", [
        { code: "invalid_type", path: ["path"], message: "This range contains binary or invalid UTF-8 data. Choose a UTF-8 text file." },
      ]);
    }
    content = content.replaceAll("\r\n", "\n");
    if (rangeComplete) content = content.replace(/\n$/u, "");
    const returnedEndLine = Math.min(endLine, line);
    return {
      content, startLine, endLine: returnedEndLine,
      totalLines: eof ? line : null,
      nextStartLine: !eof || line > endLine ? endLine + 1 : null,
    };
  } finally {
    await file.close();
  }
}
