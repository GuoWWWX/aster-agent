import { describe, expect, it } from "vitest";

import { renderAgentMarkdown } from "./agent-markdown.js";

describe("AgentMarkdown", () => {
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
      "[普通网站](https://example.com)",
    ].join(" "));

    expect(html.match(/class="agent-markdown__file-link"/gu)).toHaveLength(2);
    expect(html.match(/class="agent-markdown__file-icon"/gu)).toHaveLength(2);
    expect(html).toContain('<a href="https://example.com"');
  });
});
