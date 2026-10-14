import katex from "katex";
import type { MarkdownIt } from "markdown-it";
import { findBlockMarkdownMath, findInlineMarkdownMath, normalizeMathSource } from "./markdown-math.js";

/** Shared Markdown grammar; editor and read-only renderers use the same ranges. */
export function markdownMathPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("escape", "aster_math", (state, silent) => {
    const start = state.pos;
    if (state.src[start] !== "$" && !(state.src[start] === "\\" && state.src[start + 1] === "(")) return false;
    const range = findInlineMarkdownMath(state.src.slice(start))[0];
    if (range === undefined || range.from !== 0) return false;
    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = state.src.slice(start + range.contentFrom, start + range.contentTo);
    }
    state.pos += range.to;
    return true;
  });
  md.block.ruler.before("code", "aster_math_block", (state, startLine, endLine, silent) => {
    const start = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
    if (!/^(?:\$\$|\\\[)/u.test(state.src.slice(start))) return false;
    const source = state.getLines(startLine, endLine, state.blkIndent, false);
    const range = findBlockMarkdownMath(source)[0];
    if (range === undefined || range.from !== 0) return false;
    if (silent) return true;
    const token = state.push("math_block", "math", 0);
    token.content = source.slice(range.contentFrom, range.contentTo).replace(/^[ \t]*(?:>[ \t]?)+/gmu, "");
    token.block = true;
    state.line = startLine + source.slice(0, range.to).split(/\r?\n/u).length;
    token.map = [startLine, state.line];
    return true;
  });
  for (const type of ["math_inline", "math_block"]) md.renderer.rules[type] = (tokens, index) => {
    const source = normalizeMathSource(tokens[index]?.content ?? "");
    const html = katex.renderToString(source, { displayMode: type === "math_block", throwOnError: false, strict: "ignore", trust: false });
    return type === "math_block" ? `<div class="agent-markdown__math-block">${html}</div>\n` : html;
  };
}
