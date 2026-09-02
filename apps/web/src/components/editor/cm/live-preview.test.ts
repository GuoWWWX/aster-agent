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
});
