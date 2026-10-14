// @vitest-environment jsdom

import { GFM } from "@lezer/markdown";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { livePreviewMarkdownLanguage } from "./markdown-language.js";
import {
  frontmatterBlockExtension,
  livePreviewPlugin,
  mermaidBlockExtension,
  markdownMathBlockExtension,
  tableBlockExtension,
} from "./live-preview.js";

const mountedViews: EditorView[] = [];

class TestResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", { value: TestResizeObserver });
}

function mountEditor(documentText: string, ...extensions: Extension[]): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: documentText,
      extensions: [
        markdown({ base: livePreviewMarkdownLanguage, extensions: GFM }),
        ...extensions,
      ],
    }),
  });
  mountedViews.push(view);
  return view;
}

afterEach(() => {
  while (mountedViews.length > 0) mountedViews.pop()?.destroy();
  document.body.replaceChildren();
});

describe("live preview decorations", () => {
  it("renders ATX headings with the level-specific line class", () => {
    const view = mountEditor("# 一级标题 {-}\n\n正文", livePreviewPlugin);

    expect(view.dom.querySelector(".cm-line.mk-cm-h1")).not.toBeNull();
    expect(view.dom.querySelector(".cm-line.mk-cm-h1")?.textContent).toContain("一级标题");
    expect(view.dom.querySelector(".cm-line.mk-cm-h1")?.textContent).not.toContain("{-}");
  });

  it("renders callout lines and mounts the callout icon widget", () => {
    const view = mountEditor("> [!warning] 注意\n> 先给结论", livePreviewPlugin);

    expect(view.dom.querySelector(".cm-line.mk-cm-callout-line--amber")).not.toBeNull();
    expect(view.dom.querySelector(".mk-cm-callout-heading-prefix")).not.toBeNull();
  });

  it("replaces a GFM table with the table widget", () => {
    const view = mountEditor("| 名称 | 值 |\n| --- | --- |\n| A | 1 |", tableBlockExtension);

    expect(view.dom.querySelector(".mk-cm-table-wrapper")).not.toBeNull();
    expect(view.dom.querySelector(".mk-cm-table")).not.toBeNull();
    expect(view.dom.querySelector(".mk-cm-table")?.textContent).toContain("A");
    expect(view.dom.querySelector("thead th")).not.toBeNull();
    expect(view.dom.querySelector("tbody td")).not.toBeNull();
  });

  it("keeps short table separators at a readable default width and preserves their source", () => {
    const source = "| 名称 | 公式 |\n| - | -- |\n| 这是中文名称 | $|x|$ |";
    const view = mountEditor(source, tableBlockExtension);
    expect(view.dom.querySelector(".mk-cm-table colgroup")).toBeNull();
    expect(view.dom.querySelector<HTMLElement>(".mk-cm-table th")?.style.minWidth).toBe("72px");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("replaces a Mermaid fence with a block widget", () => {
    const view = mountEditor(
      "```mermaid {caption=\"图1-1 流程图\"}\ngraph TD\n  A-->B\n```",
      mermaidBlockExtension(false),
    );

    expect(view.dom.querySelector(".mk-cm-mermaid")).not.toBeNull();
    expect(view.dom.querySelector(".mk-cm-mermaid-canvas")).not.toBeNull();
    expect(view.dom.querySelector(".mk-cm-mermaid-caption")?.textContent).toBe("图1-1 流程图");
  });

  it("uses an adjacent bold line as a Mermaid caption", () => {
    const view = mountEditor(
      "**图1-2 邻接题注**\n```mermaid\ngraph LR\n  A-->B\n```",
      mermaidBlockExtension(false),
    );

    expect(view.dom.querySelector(".mk-cm-mermaid-caption")?.textContent).toBe("图1-2 邻接题注");
    expect(view.dom.textContent?.match(/图1-2 邻接题注/g)).toHaveLength(1);
  });

  it("renders YAML frontmatter as a block widget", () => {
    const view = mountEditor("---\ntitle: 示例\n---\n正文", frontmatterBlockExtension(false));

    expect(view.dom.querySelector(".mk-cm-frontmatter")).not.toBeNull();
    expect(view.dom.querySelector(".mk-cm-frontmatter")?.textContent).toContain("title");
  });

  it("renders quoted block math and leaves emphasis inside formulas untouched", () => {
    const view = mountEditor("开始\n\n> $$\n> x^2 + y^2\n> $$\n\n**公式 $a * b * c$ 正文**",
      livePreviewPlugin, markdownMathBlockExtension, EditorState.readOnly.of(true));
    expect(view.dom.querySelector(".mk-cm-math-block .katex")).not.toBeNull();
    expect(view.dom.querySelector(".mk-cm-math-inline .katex")).not.toBeNull();
    expect(view.dom.querySelector(".mk-cm-math-inline .mk-cm-em")).toBeNull();
    expect(view.dom.querySelector(".mk-cm-strong")).not.toBeNull();
    expect(view.dom.querySelector(".is-invalid")).toBeNull();
  });

  it("decorates safe inline HTML without adding executable elements or event handlers", () => {
    const view = mountEditor('开始\n\n<kbd onclick="alert(1)">Ctrl</kbd> H<sub>2</sub>O <script>alert(1)</script>', livePreviewPlugin);
    expect(view.dom.querySelector(".mk-cm-html-kbd")?.textContent).toBe("Ctrl");
    expect(view.dom.querySelector(".mk-cm-html-sub")?.textContent).toBe("2");
    expect(view.dom.querySelector("[onclick],script")).toBeNull();
    expect(view.state.doc.toString()).toContain('onclick="alert(1)"');
  });

  it("keeps quoted code geometry and creates the real copy control", () => {
    const view = mountEditor('开始\n\n> ```typescript\n> const value = 1;\n> ```', livePreviewPlugin);
    expect(view.dom.querySelector(".mk-cm-quote-code-line")).not.toBeNull();
    expect(view.dom.querySelector("button[aria-label='复制代码']")).not.toBeNull();
    expect(view.dom.querySelector(".mk-cm-quote-code-prefix")).not.toBeNull();
    expect(view.state.doc.toString()).toContain("> const value = 1;");
  });
});
