import { Spinner } from "../ui/loading.js";
import { createPortal } from "react-dom";
import { HtmlPreviewCard, HtmlPreviewContext, type HtmlPreviewSource } from "../html-preview/html-preview-card.js";
import { markdownMathPlugin } from "../../lib/markdown-math-plugin.js";
import { relaxedStrongPlugin } from "../../lib/relaxed-strong.js";
import { relaxedEmphasisPlugin } from "../../lib/relaxed-emphasis.js";
import { separateMarkdownCallouts } from "../../lib/markdown-callout.js";
import { parseHorizontalRuleText } from "../../lib/horizontal-rule-text.js";
import { normalizeAdjacentBoldTableCaptions } from "../../lib/markdown-block-caption.js";
import { extractExplicitImageCaptions } from "../../lib/markdown-image-caption.js";
import { mermaidFenceCaption } from "../../lib/mermaid-fence.js";
import { renderMermaid, isMermaidLanguage, mermaidToPngDataUrl } from "../../lib/mermaid.js";
import { svgDataUrl } from "../../lib/svg-image.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { safeMarkdownHtmlPlugin, markdownCalloutPlugin, markdownTablePlugin, markdownCaptionPlugin } from "./markdown-rendering-plugins.js";
import "katex/dist/katex.min.css";
import MarkdownIt from "markdown-it";
import { Check, Copy, Maximize2, CodeXml } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode, type RefObject } from "react";

import { requestMediaPreview } from "../media/image-viewer.js";
import { fileTypeIconMarkup, isRecognizedFileTypePath } from "../ui/file-type-icon-data.js";
import { highlightCode, isLargeCodeSource } from "./code-highlighter.js";
import { CodeSourceView } from "./code-source-view.js";
import { terminalTokens } from "../ui/terminal-tokens.js";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover.js";
import { resolveWorkspaceFileLink } from "./workspace-file-link.js";
import { useStreamingScroll } from "../ui/use-streaming-scroll.js";

import "./agent-markdown.css";

const copyIcon = renderToStaticMarkup(<Copy aria-hidden="true" size={16} />);
const expandIcon = renderToStaticMarkup(<Maximize2 aria-hidden="true" size={16} />);
const sourceIcon = renderToStaticMarkup(<CodeXml aria-hidden="true" size={16} />);
const copiedIcon = renderToStaticMarkup(<Check aria-hidden="true" size={16} />);
const WorkspaceFileContext = createContext<((path: string) => void) | undefined>(undefined);

export function AgentMarkdownWorkspaceScope({ onOpenFile, children }: {
  onOpenFile: ((path: string) => void) | undefined; children: ReactNode;
}): ReactElement {
  return <WorkspaceFileContext.Provider value={onOpenFile}>{children}</WorkspaceFileContext.Provider>;
}

const renderer = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false
}).use(safeMarkdownHtmlPlugin).use(markdownMathPlugin).use(relaxedStrongPlugin).use(relaxedEmphasisPlugin)
  .use(markdownCalloutPlugin).use(markdownTablePlugin).use(markdownCaptionPlugin);

renderer.block.ruler.before("hr", "agent_labeled_divider", (state, startLine, _endLine, silent) => {
  const lineStart = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
  const lineEnd = state.eMarks[startLine] ?? lineStart;
  const label = parseHorizontalRuleText(state.src.slice(lineStart, lineEnd))?.text;
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

    const checkbox = new state.Token("agent_task_checkbox", "", 0);
    checkbox.content = `<input class="agent-markdown__task-checkbox" type="checkbox" disabled${checked ? " checked" : ""} aria-label="${checked ? "已完成任务" : "未完成任务"}">`;
    token.children.unshift(checkbox);
  });
});

renderer.renderer.rules.agent_task_checkbox = (tokens, index) => tokens[index]?.content ?? "";

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

renderer.renderer.rules.table_open = (tokens, index) => {
  const caption = tokens[index]?.attrGet("data-caption");
  return '<div class="agent-markdown__table-scroll" role="region" aria-label="Markdown 表格" tabindex="0"><table>'
    + (caption == null ? "" : `<caption>${renderer.utils.escapeHtml(String(caption))}</caption>`);
};

renderer.renderer.rules.table_close = () => "</table></div>\n";

renderer.renderer.rules.fence = (tokens, index, _options, environment: unknown) => {
  const token = tokens[index];
  const language = token?.info.trim().split(/\s+/)[0] || "text";
  const source = token?.content ?? "";
  if (isMermaidLanguage(language) && token?.map !== null && token?.map !== undefined
    && typeof environment === "object" && environment !== null && "markdown" in environment && typeof environment.markdown === "string"
    && isClosedFence(environment.markdown.split("\n")[token.map[1] - 1] ?? "", token.markup)) {
    const captionValue = mermaidFenceCaption(token.info) ?? token.attrGet("data-caption");
    const caption = captionValue == null ? "" : String(captionValue);
    return `<div class="agent-markdown__mermaid"><div class="agent-markdown__code-header"><span>MERMAID</span><div><button aria-label="放大 Mermaid 图表" title="放大图表" data-action="preview-mermaid" type="button">${expandIcon}</button><button aria-label="复制 Mermaid 源码" title="复制源码" data-action="copy-mermaid" type="button">${copyIcon}</button><button aria-label="查看 Mermaid 源码" title="查看源码" data-action="toggle-mermaid-source" type="button" aria-expanded="false">${sourceIcon}</button></div></div><div class="agent-markdown__mermaid-canvas" data-mermaid-canvas></div>${caption ? `<div class="agent-markdown__mermaid-caption">${renderer.utils.escapeHtml(caption)}</div>` : ""}<pre hidden data-mermaid-source><code>${renderer.utils.escapeHtml(source)}</code></pre></div>\n`;
  }
  const label = /^(powershell|pwsh|ps1|ps)$/iu.test(language) ? "PowerShell"
    : language.toLowerCase() === "bash" ? "Bash" : language;
  const htmlPreview = /^html?$/iu.test(language) && typeof environment === "object" && environment !== null && "htmlPreview" in environment && environment.htmlPreview === true
    && token?.map != null && "markdown" in environment && typeof environment.markdown === "string"
    && isClosedFence(environment.markdown.split("\n")[token.map[1] - 1] ?? "", token.markup);
  if (htmlPreview) return `<div class="agent-markdown__code-block" data-language="${renderer.utils.escapeHtml(language)}"><template data-html-code-source>${renderer.utils.escapeHtml(source)}</template><div data-html-code-preview-slot></div></div>\n`;
  const header = `<div class="agent-markdown__code-header"><span>${renderer.utils.escapeHtml(label)}</span><button aria-label="复制代码" title="复制代码" class="agent-markdown__code-copy" data-action="copy-code" type="button">${copyIcon}</button></div>`;
  if (isLargeCodeSource(source) && typeof environment === "object" && environment !== null && "virtualCodeSources" in environment && environment.virtualCodeSources === true) {
    return `<div class="agent-markdown__code-block" data-language="${renderer.utils.escapeHtml(language)}">${header}<template data-code-source data-language="${renderer.utils.escapeHtml(language)}">${renderer.utils.escapeHtml(source)}</template><div data-code-source-slot></div></div>\n`;
  }
  const shell = /^(bash|sh|shell|zsh|powershell|pwsh|ps1|ps|cmd|bat|batch)$/iu.test(language);
  const highlightedSource = shell && !isLargeCodeSource(source) ? terminalTokens(source, true).map((token) =>
    `<span class="agent-markdown__shell-${token.kind}">${renderer.utils.escapeHtml(source.slice(token.start, token.end))}</span>`,
  ).join("") : highlightCode(source, language);
  return `<div class="agent-markdown__code-block" data-language="${renderer.utils.escapeHtml(language)}">${header}<pre><code class="hljs">${highlightedSource}</code></pre></div>\n`;
};

const defaultImage = renderer.renderer.rules.image;
renderer.renderer.rules.image = (tokens, index, options, environment, self) => {
  const token = tokens[index];
  const alt = self.renderInlineAsText(token?.children ?? [], options, environment);
  token?.attrSet("aria-label", alt ? `预览图片：${alt}` : "预览图片");
  token?.attrSet("data-action", "preview-image");
  token?.attrSet("role", "button");
  token?.attrSet("tabindex", "0");
  const renderedImage = defaultImage === undefined
    ? self.renderToken(tokens, index, options)
    : defaultImage(tokens, index, options, environment, self);
  const caption = token?.attrGet("data-caption");
  return caption == null ? renderedImage : `<figure>${renderedImage}<figcaption>${renderer.utils.escapeHtml(String(caption))}</figcaption></figure>`;
};

export const AgentMarkdown = memo(function AgentMarkdown({ content, streaming = false }: { content: string; streaming?: boolean }): ReactElement {
  const scrollHostRef = useRef<HTMLDivElement>(null);
  useStreamingScroll(scrollHostRef, content, streaming);
  return <AgentMarkdownContent key={content} content={content} scrollHostRef={scrollHostRef} />;
});

function AgentMarkdownContent({ content, scrollHostRef }: { content: string; scrollHostRef: RefObject<HTMLDivElement | null> }): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const [codePreviews, setCodePreviews] = useState<Array<{ source: string; mount: Element }>>([]);
  const [sourceViews, setSourceViews] = useState<Array<{ source: string; language: string; mount: Element }>>([]);
  const theme = useWorkbenchUiStore((state) => state.themeMode);
  const previewContext = useContext(HtmlPreviewContext);
  const workspaceContext = useContext(WorkspaceFileContext);
  const [activePreview, setActivePreview] = useState<{ source: HtmlPreviewSource; mount: Element } | null>(null);
  const [diagramMenu, setDiagramMenu] = useState<{ source: string; x: number; y: number } | null>(null);
  const [copyingImage, setCopyingImage] = useState(false);
  const [copyImageError, setCopyImageError] = useState<string | null>(null);
  const canPreview = previewContext !== null;
  const html = useMemo(() => renderAgentMarkdown(content, canPreview, true), [content, canPreview]);
  // Keep parser-owned DOM intact on theme changes: native details state, source
  // toggles and diagram height must survive while the next SVG is rendering.
  const markup = useMemo(() => ({ __html: html }), [html]);
  const bindHost = useCallback((host: HTMLDivElement | null): void => {
    hostRef.current = host;
    scrollHostRef.current = host;
    if (host === null) return;
    const previews = [...host.querySelectorAll<HTMLTemplateElement>("[data-html-code-source]")].flatMap(template => {
      const mount = template.parentElement?.querySelector("[data-html-code-preview-slot]");
      return mount == null ? [] : [{ source: template.content.textContent ?? "", mount }];
    });
    if (previews.length > 0) setCodePreviews(previews);
    const sources = [...host.querySelectorAll<HTMLTemplateElement>("[data-code-source]")].flatMap(template => {
      const mount = template.parentElement?.querySelector("[data-code-source-slot]");
      return mount == null ? [] : [{ source: template.content.textContent ?? "", language: template.dataset.language ?? "text", mount }];
    });
    if (sources.length > 0) setSourceViews(sources);
  }, [scrollHostRef]);
  useEffect(() => {
    let alive = true;
    for (const card of hostRef.current?.querySelectorAll<HTMLElement>(".agent-markdown__mermaid") ?? []) {
      const canvas = card.querySelector<HTMLElement>("[data-mermaid-canvas]");
      const source = card.querySelector("[data-mermaid-source] code")?.textContent;
      if (canvas === null || source == null) continue;
      if (!canvas.firstChild) canvas.textContent = "正在绘制图表…";
      void renderMermaid(source, theme === "dark").then((result) => {
        if (alive && canvas.isConnected) { canvas.innerHTML = result.svg; canvas.removeAttribute("data-error"); }
      }).catch(() => {
        if (alive && canvas.isConnected) { canvas.textContent = "图表语法有误，请查看源码。"; canvas.dataset.error = "true"; }
      });
    }
    return () => { alive = false; };
  }, [html, theme]);
  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a[href]");
    const href = link?.getAttribute("href") ?? "";
    if (previewContext !== null && href && !/^[a-z][a-z\d+.-]*:/iu.test(href) && /\.html?(?:[?#].*)?$/iu.test(href)) {
      const mount = event.currentTarget.querySelector("[data-html-file-preview-slot]");
      if (mount !== null) { event.preventDefault();
        try { setActivePreview({ source: { kind: "file", path: decodeURIComponent(href.split(/[?#]/u)[0]!) }, mount }); } catch { /* Invalid encoded links retain their original text. */ }
      }
      return;
    }
    if (href && workspaceContext !== undefined) {
      const path = resolveWorkspaceFileLink(href);
      if (path !== null) { event.preventDefault(); workspaceContext(path); return; }
    }
    const image = event.target.closest<HTMLImageElement>("img[data-action='preview-image']");
    if (image !== null && event.currentTarget.contains(image)) {
      requestMediaPreview({
        alt: image.alt,
        src: image.currentSrc || image.src,
        title: image.alt || "图片预览",
      });
      return;
    }
    const action = event.target.closest<HTMLButtonElement>("button[data-action]");
    const card = action?.closest<HTMLElement>(".agent-markdown__mermaid");
    if (card != null && action != null) {
      const source = card.querySelector<HTMLElement>("[data-mermaid-source]");
      if (action.dataset.action === "toggle-mermaid-source" && source !== null) {
        source.hidden = !source.hidden;
        const preview = card.querySelector<HTMLElement>("[data-mermaid-canvas]");
        const caption = card.querySelector<HTMLElement>(".agent-markdown__mermaid-caption");
        if (preview !== null) preview.hidden = !source.hidden;
        if (caption !== null) caption.hidden = !source.hidden;
        action.setAttribute("aria-expanded", String(!source.hidden));
        action.setAttribute("aria-label", source.hidden ? "查看 Mermaid 源码" : "预览 Mermaid 图表");
        action.title = source.hidden ? "查看源码" : "切回预览";
        return;
      }
      if (action.dataset.action === "copy-mermaid") { void navigator.clipboard.writeText(source?.textContent ?? "").catch(() => undefined); return; }
      if (action.dataset.action === "preview-mermaid") { const svg = card.querySelector("[data-mermaid-canvas] svg"); if (svg !== null) requestMediaPreview({ src: svgDataUrl(svg.outerHTML), title: "Mermaid 图表" }); return; }
    }
    const button = event.target.closest<HTMLButtonElement>("[data-action='copy-code']");
    if (button === null || !event.currentTarget.contains(button)) return;
    const block = button.closest(".agent-markdown__code-block");
    const code = block?.querySelector<HTMLTemplateElement>("[data-code-source]")?.content.textContent ?? block?.querySelector("code")?.textContent;
    if (code === null || code === undefined) return;

    void navigator.clipboard.writeText(code).then(() => {
      button.innerHTML = copiedIcon;
      button.setAttribute("aria-label", "已复制");
      button.title = "已复制";
      window.setTimeout(() => {
        if (button.isConnected) {
          button.innerHTML = copyIcon;
          button.setAttribute("aria-label", "复制代码");
          button.title = "复制代码";
        }
      }, 1_500);
    }).catch(() => undefined);
  }, [previewContext, workspaceContext]);

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

  const handleDiagramContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof Element)) return;
    const canvas = event.target.closest<HTMLElement>("[data-mermaid-canvas]");
    if (canvas === null || canvas.hidden || canvas.querySelector("svg") === null) return;
    const source = canvas.closest(".agent-markdown__mermaid")?.querySelector("[data-mermaid-source] code")?.textContent;
    if (source === undefined || source === null) return;
    event.preventDefault();
    event.stopPropagation();
    setCopyImageError(null);
    setDiagramMenu({ source, x: event.clientX, y: event.clientY });
  };

  const copyDiagramImage = async (event: MouseEvent<HTMLButtonElement>): Promise<void> => {
    if (diagramMenu === null) return;
    const menu = diagramMenu;
    const clipboard = event.currentTarget.ownerDocument.defaultView?.navigator.clipboard;
    setCopyingImage(true);
    setCopyImageError(null);
    try {
      if (clipboard?.write === undefined || typeof ClipboardItem === "undefined") throw new Error("Image clipboard is unavailable.");
      // Start the clipboard request in the focused menu document while the click
      // still supplies user activation; PNG rendering can finish asynchronously.
      const image = mermaidToPngDataUrl(menu.source, theme === "dark").then(async (url) => (await fetch(url)).blob());
      await clipboard.write([new ClipboardItem({ "image/png": image })]);
      setDiagramMenu((current) => current === menu ? null : current);
    } catch {
      setCopyImageError("无法复制图表图片，请重试。");
    } finally {
      setCopyingImage(false);
    }
  };

  return (<>
    <div
      ref={bindHost}
      className="agent-markdown"
      dangerouslySetInnerHTML={markup}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleDiagramContextMenu}
    />
    {codePreviews.map((preview, index) => createPortal(<HtmlPreviewCard source={{ kind: "code", html: preview.source }} embedded />, preview.mount, String(index)))}
    {sourceViews.map((view, index) => createPortal(<CodeSourceView source={view.source} language={view.language} />, view.mount, `source:${index}`))}
    {activePreview !== null ? createPortal(<HtmlPreviewCard key={activePreview.source.kind === "file" ? activePreview.source.path : activePreview.source.html} source={activePreview.source} />, activePreview.mount) : null}
    <Popover open={diagramMenu !== null} onOpenChange={(open) => { if (!open) setDiagramMenu(null); }}>
      <PopoverAnchor asChild><span aria-hidden="true" className="pointer-events-none fixed size-0" style={{ left: diagramMenu?.x ?? 0, top: diagramMenu?.y ?? 0 }} /></PopoverAnchor>
      <PopoverContent align="start" side="bottom" sideOffset={0} role="menu" aria-label="Mermaid 图表菜单"
        className="min-w-36 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-1 text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] shadow-lg">
        <button type="button" role="menuitem" disabled={copyingImage} onClick={(event) => void copyDiagramImage(event)}
          className="flex h-8 w-full items-center gap-2 rounded-[var(--app-radius-small)] px-2 text-left hover:bg-[var(--app-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)] disabled:opacity-50">
          {copyingImage ? <Spinner size={14} /> : <Copy aria-hidden="true" size={14} />}{copyingImage ? "正在复制图片…" : "复制图片"}
        </button>
        {copyImageError === null ? null : <p role="status" className="px-2 py-1 text-[var(--app-status-danger-fg)]">{copyImageError}</p>}
      </PopoverContent>
    </Popover>
  </>);
}

function isClosedFence(line: string, opening: string): boolean {
  const closing = line.replace(/^[ \t]*(?:>[ \t]?)+/u, "").trim().match(/^(`{3,}|~{3,})$/u)?.[1];
  return closing !== undefined && closing[0] === opening[0] && closing.length >= opening.length;
}

export function renderAgentMarkdown(content: string, htmlPreview = false, virtualCodeSources = false): string {
  const extracted = extractExplicitImageCaptions(separateMarkdownCallouts(content));
  const markdown = normalizeAdjacentBoldTableCaptions(extracted.markdown);
  return renderer.render(markdown, { markdown, htmlPreview, virtualCodeSources, imageCaptions: extracted.captionsByImageIndex }) + (htmlPreview ? '<div data-html-file-preview-slot></div>' : "");
}
