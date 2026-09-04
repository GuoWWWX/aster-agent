import MarkdownIt from "markdown-it";
import { useCallback, useMemo, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";

import { requestMediaPreview } from "../media/image-viewer.js";
import { fileTypeIconMarkup, isRecognizedFileTypePath } from "../ui/file-type-icon-data.js";
import { highlightCode } from "./code-highlighter.js";

import "./agent-markdown.css";

const renderer = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false
});

renderer.block.ruler.before("hr", "agent_labeled_divider", (state, startLine, _endLine, silent) => {
  const lineStart = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
  const lineEnd = state.eMarks[startLine] ?? lineStart;
  const match = /^---[\t ]+(.+?)[\t ]*$/u.exec(state.src.slice(lineStart, lineEnd));
  const label = match?.[1]?.trim();
  if (label === undefined || label.length === 0) return false;
  if (silent) return true;

  const token = state.push("agent_labeled_divider", "", 0);
  token.block = true;
  token.content = label;
  token.map = [startLine, startLine + 1];
  state.line = startLine + 1;
  return true;
});

renderer.renderer.rules.agent_labeled_divider = (tokens, index) => {
  const label = renderer.utils.escapeHtml(tokens[index]?.content ?? "");
  return `<div class="agent-markdown__labeled-divider" role="separator" aria-label="${label}"><span>${label}</span></div>\n`;
};

renderer.core.ruler.after("inline", "agent_task_lists", (state) => {
  state.tokens.forEach((token, tokenIndex) => {
    if (token.type !== "inline" || token.children?.[0]?.type !== "text") {
      return;
    }

    const firstChild = token.children[0];
    const taskMarker = /^\[([ xX])\]\s+/.exec(firstChild.content);
    if (taskMarker === null) {
      return;
    }

    let listItemOpen;
    for (let index = tokenIndex - 1; index >= 0; index -= 1) {
      if (state.tokens[index]?.type === "list_item_close") {
        break;
      }
      if (state.tokens[index]?.type === "list_item_open") {
        listItemOpen = state.tokens[index];
        break;
      }
    }
    if (listItemOpen === undefined) {
      return;
    }

    const checked = taskMarker[1]?.toLowerCase() === "x";
    firstChild.content = firstChild.content.slice(taskMarker[0].length);
    listItemOpen.attrJoin("class", "agent-markdown__task-item");

    const checkbox = new state.Token("html_inline", "", 0);
    checkbox.content = `<input class="agent-markdown__task-checkbox" type="checkbox" disabled${checked ? " checked" : ""} aria-label="${checked ? "已完成任务" : "未完成任务"}">`;
    token.children.unshift(checkbox);
  });
});

const defaultLinkOpen = renderer.renderer.rules.link_open;
renderer.renderer.rules.link_open = (tokens, index, options, environment, self) => {
  const token = tokens[index];
  token?.attrSet("rel", "noreferrer noopener");
  token?.attrSet("target", "_blank");
  const hrefValue = token?.attrGet("href");
  const href = hrefValue === null || hrefValue === undefined ? "" : String(hrefValue);
  const isFileLink = isRecognizedFileTypePath(href);
  if (isFileLink) token?.attrJoin("class", "agent-markdown__file-link");
  const openingTag = defaultLinkOpen === undefined
    ? self.renderToken(tokens, index, options)
    : defaultLinkOpen(tokens, index, options, environment, self);
  return isFileLink
    ? `${openingTag}${fileTypeIconMarkup(href)}<span class="agent-markdown__file-label">`
    : openingTag;
};

const defaultLinkClose = renderer.renderer.rules.link_close;
renderer.renderer.rules.link_close = (tokens, index, options, environment, self) => {
  const openingToken = tokens.slice(0, index).findLast((token) => token.type === "link_open");
  const hrefValue = openingToken?.attrGet("href");
  const href = hrefValue === null || hrefValue === undefined ? "" : String(hrefValue);
  const closingTag = defaultLinkClose === undefined
    ? self.renderToken(tokens, index, options)
    : defaultLinkClose(tokens, index, options, environment, self);
  return isRecognizedFileTypePath(href) ? `</span>${closingTag}` : closingTag;
};

// MarkdownIt derives inline alignment styles from the separator row. The chat
// renderer uses a fixed table contract instead: centered headers and left body
// cells, regardless of alignment markers in the source Markdown.
const defaultTableHeaderOpen = renderer.renderer.rules.th_open;
renderer.renderer.rules.th_open = (tokens, index, options, environment, self) => {
  const token = tokens[index];
  if (token?.attrs) token.attrs = token.attrs.filter(([name]) => name !== "style");
  return defaultTableHeaderOpen === undefined
    ? self.renderToken(tokens, index, options)
    : defaultTableHeaderOpen(tokens, index, options, environment, self);
};

const defaultTableCellOpen = renderer.renderer.rules.td_open;
renderer.renderer.rules.td_open = (tokens, index, options, environment, self) => {
  const token = tokens[index];
  if (token?.attrs) token.attrs = token.attrs.filter(([name]) => name !== "style");
  return defaultTableCellOpen === undefined
    ? self.renderToken(tokens, index, options)
    : defaultTableCellOpen(tokens, index, options, environment, self);
};

renderer.renderer.rules.table_open = () => (
  '<div class="agent-markdown__table-scroll" role="region" aria-label="Markdown 表格" tabindex="0"><table>'
);

renderer.renderer.rules.table_close = () => "</table></div>\n";

renderer.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const language = token?.info.trim().split(/\s+/)[0] || "text";
  const source = token?.content ?? "";
  const highlightedSource = highlightCode(source, language);
  return `<pre class="agent-markdown__code-block" data-language="${renderer.utils.escapeHtml(language)}"><button aria-label="复制代码" class="agent-markdown__code-copy" data-action="copy-code" type="button">复制</button><code class="hljs">${highlightedSource}</code></pre>\n`;
};

const defaultImage = renderer.renderer.rules.image;
renderer.renderer.rules.image = (tokens, index, options, environment, self) => {
  const token = tokens[index];
  const alt = self.renderInlineAsText(token?.children ?? [], options, environment);
  token?.attrSet("aria-label", alt ? `预览图片：${alt}` : "预览图片");
  token?.attrSet("data-action", "preview-image");
  token?.attrSet("role", "button");
  token?.attrSet("tabindex", "0");
  return defaultImage === undefined
    ? self.renderToken(tokens, index, options)
    : defaultImage(tokens, index, options, environment, self);
};

export function AgentMarkdown({ content }: { content: string }): ReactElement {
  const html = useMemo(() => renderAgentMarkdown(content), [content]);
  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof Element)) return;
    const image = event.target.closest<HTMLImageElement>("img[data-action='preview-image']");
    if (image !== null && event.currentTarget.contains(image)) {
      requestMediaPreview({
        alt: image.alt,
        src: image.currentSrc || image.src,
        title: image.alt || "图片预览",
      });
      return;
    }
    const button = event.target.closest<HTMLButtonElement>("[data-action='copy-code']");
    if (button === null || !event.currentTarget.contains(button)) return;
    const code = button.closest("pre")?.querySelector("code")?.textContent;
    if (code === null || code === undefined) return;

    void navigator.clipboard.writeText(code).then(() => {
      button.textContent = "已复制";
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = "复制";
      }, 1_500);
    }).catch(() => undefined);
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!(event.target instanceof HTMLImageElement) || event.target.dataset.action !== "preview-image") return;
    event.preventDefault();
    requestMediaPreview({
      alt: event.target.alt,
      src: event.target.currentSrc || event.target.src,
      title: event.target.alt || "图片预览",
    });
  }, []);

  return (
    <div
      className="agent-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    />
  );
}

export function renderAgentMarkdown(content: string): string {
  return renderer.render(content);
}
