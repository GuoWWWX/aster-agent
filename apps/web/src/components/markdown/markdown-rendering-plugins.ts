import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MarkdownIt, Token } from "markdown-it";
import { parseMarkdownInlineHtmlTag, markdownInlineHtmlPlugin } from "../../lib/markdown-inline-html.js";
import { markdownCalloutIcon } from "./markdown-callout-icon.js";
import { parseMarkdownCalloutHeader, type MarkdownCalloutHeader } from "../../lib/markdown-callout.js";
import { parseUnnumberedHeadingText } from "../../lib/markdown-heading-attributes.js";
import { parseMarkdownTable } from "../editor/cm/markdown-table.js";
import { markdownCaptionText, mermaidFenceCaption } from "../../lib/mermaid-fence.js";
import { isMermaidLanguage } from "../../lib/mermaid.js";

export function markdownCaptionPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "aster_captions", (state) => {
    const environment: unknown = state.env;
    const lines = typeof environment === "object" && environment !== null && "markdown" in environment && typeof environment.markdown === "string"
      ? environment.markdown.split("\n") : [];
    let imageIndex = 0;
    for (const token of state.tokens) {
      if (token.type !== "inline" || token.children?.length !== 1 || token.children[0]?.type !== "image") continue;
      if (token.map === null || !/^\s*!\[[^\]]*\]\([^)]*\)(?:\{[^}]*\})?\s*$/u.test(lines[token.map[0]] ?? "")) continue;
      if (typeof environment === "object" && environment !== null && "imageCaptions" in environment && environment.imageCaptions instanceof Map) {
        const caption: unknown = environment.imageCaptions.get(imageIndex);
        if (typeof caption === "string") token.children[0].attrSet("data-caption", caption);
      }
      imageIndex++;
    }
    for (let index = 0; index < state.tokens.length; index++) {
      const token = state.tokens[index];
      if (token?.type !== "table_open" && !(token?.type === "fence" && isMermaidLanguage(token.info.split(/\s/u)[0]))) continue;
      if (token.type === "fence" && mermaidFenceCaption(token.info)) continue;
      const before = state.tokens[index - 2];
      const after = state.tokens[index + 2];
      if (token.type === "fence" && after?.type === "inline" && state.tokens[index + 1]?.type === "paragraph_open" && token.map?.[1] === after.map?.[0] && markdownCaptionText(after.content)) {
        token.attrSet("data-caption", markdownCaptionText(after.content) ?? "");
        state.tokens.splice(index + 1, 3);
      } else if (before?.type === "inline" && state.tokens[index - 3]?.type === "paragraph_open" && state.tokens[index - 1]?.type === "paragraph_close" && token.map?.[0] === before.map?.[1] && markdownCaptionText(before.content)) {
        token.attrSet("data-caption", markdownCaptionText(before.content) ?? "");
        state.tokens.splice(index - 3, 3); index -= 3;
      }
    }
  });
}

export function safeMarkdownHtmlPlugin(md: MarkdownIt): void {
  md.use(markdownInlineHtmlPlugin);
  md.renderer.rules.html_inline = (tokens, index) => {
    const raw = tokens[index]?.content ?? "";
    const tag = parseMarkdownInlineHtmlTag(raw);
    if (tag === null) return md.utils.escapeHtml(raw);
    if (tag.closing) return `</${tag.name}>`;
    const attrs: string[] = [];
    for (const name of ["title", "alt", "datetime"]) {
      const value = tag.attributes[name];
      if (value !== undefined) attrs.push(`${name}="${md.utils.escapeHtml(value)}"`);
    }
    if (tag.name === "a" || tag.name === "img") {
      const name = tag.name === "a" ? "href" : "src";
      const value = tag.attributes[name];
      if (value !== undefined && md.validateLink(value)) attrs.push(`${name}="${md.utils.escapeHtml(value)}"`);
      if (tag.name === "a") attrs.push('target="_blank" rel="noreferrer noopener"');
      else attrs.push('loading="lazy" role="button" tabindex="0" data-action="preview-image"');
    }
    if (tag.name === "details" && Object.hasOwn(tag.attributes, "open")) attrs.push("open");
    return `<${tag.name}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
  };
}

export function markdownCalloutPlugin(md: MarkdownIt): void {
  const openings = new WeakMap<Token, MarkdownCalloutHeader>();
  const closings = new WeakMap<Token, MarkdownCalloutHeader>();
  md.core.ruler.after("inline", "aster_callouts", (state) => {
    for (let index = 0; index < state.tokens.length; index++) {
      const open = state.tokens[index];
      const inline = state.tokens[index + 2];
      if (open?.type !== "blockquote_open" || inline?.type !== "inline") continue;
      const lines = inline.content.split("\n");
      const header = parseMarkdownCalloutHeader(lines[0] ?? "");
      if (header === undefined) continue;
      let depth = 1;
      for (let cursor = index + 1; cursor < state.tokens.length; cursor++) {
        const token = state.tokens[cursor];
        if (token?.type === "blockquote_open") depth++;
        if (token?.type === "blockquote_close" && --depth === 0) { closings.set(token, header); break; }
      }
      openings.set(open, header);
      inline.content = lines.slice(1).join("\n");
      inline.children = md.parseInline(inline.content, state.env)[0]?.children ?? [];
    }
  });
  md.renderer.rules.blockquote_open = (tokens, index, options, _env, self) => {
    const token = tokens[index];
    if (token === undefined) return "";
    const header = openings.get(token);
    if (header === undefined) return self.renderToken(tokens, index, options);
    const title = md.renderInline(header.title || header.defaultTitle);
    const icon = renderToStaticMarkup(createElement(markdownCalloutIcon(header.type, header.tone), { size: 16, "aria-hidden": true }));
    const attributes = `class="agent-markdown__callout" data-tone="${header.tone}"`;
    return header.fold === undefined
      ? `<aside ${attributes} role="note"><div class="agent-markdown__callout-title">${icon}${title}</div>`
      : `<details ${attributes}${header.fold === "expanded" ? " open" : ""}><summary class="agent-markdown__callout-title">${icon}${title}</summary>`;
  };
  md.renderer.rules.blockquote_close = (tokens, index, options, _env, self) => {
    const token = tokens[index];
    const header = token === undefined ? undefined : closings.get(token);
    return header === undefined ? self.renderToken(tokens, index, options) : header.fold === undefined ? "</aside>\n" : "</details>\n";
  };
  md.core.ruler.before("inline", "aster_heading_attributes", (state) => {
    state.tokens.forEach((token, index) => {
      if (token.type === "heading_open" && state.tokens[index + 1]?.type === "inline") {
        const title = state.tokens[index + 1];
        if (title !== undefined) title.content = parseUnnumberedHeadingText(title.content).text;
      }
    });
  });
}

export function markdownTablePlugin(md: MarkdownIt): void {
  md.block.ruler.before("table", "aster_table", (state, startLine, endLine, silent) => {
    if (startLine + 1 >= endLine) return false;
    const line = (number: number): string => state.src.slice((state.bMarks[number] ?? 0) + (state.tShift[number] ?? 0), state.eMarks[number] ?? 0);
    if (!line(startLine).includes("|") || !/^[\s|:-]+$/u.test(line(startLine + 1))) return false;
    let end = startLine + 2;
    while (end < endLine && line(end).includes("|") && line(end).trim()) end++;
    const table = parseMarkdownTable(Array.from({ length: end - startLine }, (_, offset) => line(startLine + offset)).join("\n"));
    if (table === null) return false;
    if (silent) return true;
    const open = state.push("table_open", "table", 1); open.map = [startLine, end];
    const pushRow = (cells: string[], header: boolean): void => {
      state.push("tr_open", "tr", 1);
      for (const cell of cells) {
        state.push(header ? "th_open" : "td_open", header ? "th" : "td", 1);
        const token = state.push("inline", "", 0); token.content = cell; token.children = [];
        state.push(header ? "th_close" : "td_close", header ? "th" : "td", -1);
      }
      state.push("tr_close", "tr", -1);
    };
    state.push("thead_open", "thead", 1); pushRow(table.rows[0] ?? [], true); state.push("thead_close", "thead", -1);
    state.push("tbody_open", "tbody", 1); for (const row of table.rows.slice(1)) pushRow(row, false); state.push("tbody_close", "tbody", -1);
    state.push("table_close", "table", -1); state.line = end;
    return true;
  });
}
