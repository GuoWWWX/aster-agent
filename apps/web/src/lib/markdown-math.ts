export type MarkdownMathRange = { from: number; to: number; contentFrom: number; contentTo: number; display: boolean };

function escapedAt(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function skipCodeSpan(source: string, index: number): number {
  let length = 0;
  while (source[index + length] === "`") length += 1;
  const marker = "`".repeat(length);
  const close = source.indexOf(marker, index + length);
  return close < 0 ? source.length : close + length;
}

export function findInlineMarkdownMath(source: string): MarkdownMathRange[] {
  const ranges: MarkdownMathRange[] = [];
  for (let index = 0; index < source.length;) {
    if (source[index] === "`") { index = skipCodeSpan(source, index); continue; }
    if (source[index] === "$" && source[index - 1] !== "$" && source[index + 1] !== "$" && !escapedAt(source, index)) {
      const close = source.indexOf("$", index + 1);
      if (close > index + 1 && !escapedAt(source, close)) {
        ranges.push({ from: index, to: close + 1, contentFrom: index + 1, contentTo: close, display: false });
        index = close + 1; continue;
      }
    }
    if (source[index] === "\\" && source[index + 1] === "(" && !escapedAt(source, index)) {
      const close = source.indexOf("\\)", index + 2);
      if (close > index + 2) {
        ranges.push({ from: index, to: close + 2, contentFrom: index + 2, contentTo: close, display: false });
        index = close + 2; continue;
      }
    }
    index += 1;
  }
  return ranges;
}

export function findBlockMarkdownMath(source: string): MarkdownMathRange[] {
  const lines = source.split(/\r?\n/);
  const ranges: MarkdownMathRange[] = [];
  let offset = 0;
  let fence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s*(`{3,}|~{3,})/.test(line)) { fence = !fence; offset += line.length + 1; continue; }
    if (fence || (line.trim() !== "$$" && line.trim() !== "\\[")) { offset += line.length + 1; continue; }
    const closing = line.trim() === "$$" ? "$$" : "\\]";
    const contentOffset = offset + line.length + 1;
    for (let next = index + 1, cursor = contentOffset; next < lines.length; next += 1) {
      if ((lines[next] ?? "").trim() === closing) {
        if (cursor < offsetOfLine(lines, next)) ranges.push({ from: offset, to: offsetOfLine(lines, next) + (lines[next]?.length ?? 0), contentFrom: contentOffset, contentTo: offsetOfLine(lines, next) - 1, display: true });
        index = next; offset = offsetOfLine(lines, next) + (lines[next]?.length ?? 0) + 1; break;
      }
      cursor += (lines[next]?.length ?? 0) + 1;
    }
  }
  return ranges;
}

function offsetOfLine(lines: string[], index: number): number { return lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0); }
