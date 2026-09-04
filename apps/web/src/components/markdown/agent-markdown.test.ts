// @vitest-environment jsdom

import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { MediaPreviewDialogHost } from "../media/image-viewer.js";
import { TooltipProvider } from "../ui/tooltip.js";
import { AgentMarkdown, renderAgentMarkdown } from "./agent-markdown.js";
import agentMarkdownStyles from "./agent-markdown.css?inline";

describe("AgentMarkdown", () => {
  it("restores md-king-compatible markers for ordered and nested unordered lists", () => {
    const style = document.createElement("style");
    style.textContent = agentMarkdownStyles;
    document.head.append(style);
    const preview = document.createElement("div");
    preview.className = "agent-markdown";
    preview.innerHTML = renderAgentMarkdown([
      "- 一级",
      "  - 二级",
      "    - 三级",
      "",
      "1. 有序项",
    ].join("\n"));
    document.body.append(preview);

    const unorderedLists = preview.querySelectorAll("ul");
    const orderedList = preview.querySelector("ol");
    expect(unorderedLists).toHaveLength(3);
    expect(getComputedStyle(unorderedLists[0]!).listStyleType).toBe("disc");
    expect(getComputedStyle(unorderedLists[1]!).listStyleType).toBe("circle");
    expect(getComputedStyle(unorderedLists[2]!).listStyleType).toBe("square");
    expect(orderedList).not.toBeNull();
    expect(getComputedStyle(orderedList!).listStyleType).toBe("decimal");
  });

  it("renders md-king-compatible Markdown elements without accepting raw HTML", () => {
    const html = renderAgentMarkdown(
      "# 结果\n\n- [ ] 待处理\n- [x] 已完成\n\n~~删除~~ [文档](https://example.com)\n\n```java\ninterface Assistant {}\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>"
    );

    expect(html).toContain('class="agent-markdown__task-item"');
    expect(html).toContain('aria-label="未完成任务"');
    expect(html).toContain('aria-label="已完成任务"');
    expect(html).toContain(" checked");
    expect(html).toContain("<s>删除</s>");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('class="agent-markdown__code-block"');
    expect(html).toContain("data-language=\"java\"");
    expect(html).toContain('class="agent-markdown__code-copy"');
    expect(html).toContain('aria-label="复制代码"');
    expect(html).toContain('class="hljs"');
    expect(html).toContain('class="hljs-keyword"');
    expect(html).toContain('class="agent-markdown__table-scroll"');
    expect(html).toContain("<table>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");

    const fencedHtml = renderAgentMarkdown("```html\n<script>alert(1)</script>\n```");
    expect(fencedHtml).toContain("&lt;");
    expect(fencedHtml).not.toContain("<script>");
  });

  it("uses centered headers and left-aligned body cells for Markdown tables", () => {
    const html = renderAgentMarkdown(
      "| 次数 | 目标地址 | 发送/接收 |\n| ---: | :--- | ---: |\n| 1 | `198.18.0.8` | 4/4 |",
    );

    expect(html).toContain("<th>次数</th>");
    expect(html).toContain("<td>1</td>");
    expect(html).not.toContain('style="text-align:right"');
    expect(html).not.toContain('style="text-align:left"');
  });

  it("decorates file links with shared type icons without changing ordinary web links", () => {
    const html = renderAgentMarkdown([
      "[Word 文档](docs/report.docx)",
      "[TSX 文件](src/app.tsx)",
      "[Java 文件](src/BubbleSort.java)",
      "[普通网站](https://example.com)",
    ].join(" "));

    expect(html.match(/class="agent-markdown__file-link"/gu)).toHaveLength(3);
    expect(html.match(/class="agent-markdown__file-icon/gu)).toHaveLength(3);
    expect(html.match(/class="agent-markdown__file-label"/gu)).toHaveLength(3);
    expect(html.match(/<\/span><\/a>/gu)).toHaveLength(3);
    expect(html).toContain('<a href="https://example.com"');
  });

  it("renders labeled dividers without changing ordinary horizontal rules", () => {
    const html = renderAgentMarkdown([
      "---",
      "",
      "--- 上下文已压缩",
      "",
      "```text",
      "--- 代码里的文字",
      "```",
    ].join("\n"));

    expect(html).toContain("<hr>");
    expect(html).toContain('class="agent-markdown__labeled-divider"');
    expect(html).toContain('aria-label="上下文已压缩"');
    expect(html).toContain("<span>上下文已压缩</span>");
    expect(html.match(/agent-markdown__labeled-divider/gu)).toHaveLength(1);
    expect(html).toContain("--- 代码里的文字");
  });

  it("escapes labeled divider text", () => {
    const html = renderAgentMarkdown("--- <img src=x onerror=alert(1)>");

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
  });

  it("marks rendered images as keyboard-accessible previews", () => {
    const html = renderAgentMarkdown("![运行结果](assets/result.png)");

    expect(html).toContain('data-action="preview-image"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="预览图片：运行结果"');
  });

  it("opens the shared overlay viewer when a Markdown image is clicked", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("ResizeObserver", class {
      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(createElement(
        TooltipProvider,
        null,
        createElement(
          Fragment,
          null,
          createElement(AgentMarkdown, { content: "![运行结果](data:image/png;base64,AQID)" }),
          createElement(MediaPreviewDialogHost),
        ),
      ));
    });
    act(() => {
      (container.querySelector("img[data-action='preview-image']") as HTMLImageElement).click();
    });

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('button[aria-label="放大图片"]')).not.toBeNull();
    expect(document.body.querySelector('button[aria-label="使图片适应窗口"]')).not.toBeNull();

    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
});
