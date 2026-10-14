// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownMathBlockExtension } from "./cm/live-preview.js";
import { LiveMarkdownEditor } from "./live-markdown-editor.js";

const roots: Root[] = [];
afterEach(() => {
  act(() => { roots.splice(0).forEach((root) => root.unmount()); });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function mount(content: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node); roots.push(root);
  const onDirty = vi.fn(); const onRequestSave = vi.fn(); const onDocChanged = vi.fn();
  const props = { documentKey: "one.md", initialContent: content, isDark: false, onDirty, onRequestSave, onDocChanged };
  act(() => root.render(createElement(LiveMarkdownEditor, props)));
  const editorNode = node.querySelector<HTMLElement>(".cm-editor");
  if (editorNode === null) throw new Error("Editor not mounted");
  const view = EditorView.findFromDOM(editorNode);
  if (view === null) throw new Error("Editor view not found");
  return { node, root, view, props, onDirty, onRequestSave, onDocChanged };
}

describe("Markdown editor integration", () => {
  it("retains unsaved content, selection, undo, math widgets and scroll on a theme change", () => {
    const source = "正文\n\n$$\nx^2 + y^2\n$$\n\n末尾";
    const { root, view, props, onDirty } = mount(source);
    act(() => view.dispatch({ changes: { from: source.length, insert: "新增" }, selection: { anchor: source.length + 2 } }));
    const mathState = view.state.field(markdownMathBlockExtension);
    const mathWidget = view.dom.querySelector(".mk-cm-math-block");
    expect(mathWidget).not.toBeNull();
    view.scrollDOM.scrollTop = 123;
    act(() => root.render(createElement(LiveMarkdownEditor, { ...props, isDark: true, initialContent: "父组件尚未回传的旧内容" })));
    expect(view.state.doc.toString()).toBe(source + "新增");
    expect(view.state.selection.main.head).toBe(source.length + 2);
    expect(view.scrollDOM.scrollTop).toBe(123);
    expect(view.state.field(markdownMathBlockExtension)).toBe(mathState);
    expect(view.dom.querySelector(".mk-cm-math-block")).toBe(mathWidget);
    expect(onDirty).toHaveBeenCalledWith(source + "新增");
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe(source);
  });
  it("saves the current editor content before debounced callbacks and only reloads an explicit revision", () => {
    const { root, view, props, onRequestSave } = mount("正文");
    act(() => view.dispatch({ changes: { from: 2, insert: "最后输入" } }));
    act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(onRequestSave).toHaveBeenCalledWith("正文最后输入");
    act(() => root.render(createElement(LiveMarkdownEditor, { ...props, initialContent: "磁盘正文" })));
    expect(view.state.doc.toString()).toBe("正文最后输入");
    act(() => root.render(createElement(LiveMarkdownEditor, { ...props, initialContent: "磁盘正文", contentRevision: 1 })));
    expect(view.state.doc.toString()).toBe("磁盘正文");
  });
  it("resets the document view when another file is selected", () => {
    const { root, view, props } = mount("旧文档");
    view.scrollDOM.scrollTop = 456;
    act(() => root.render(createElement(LiveMarkdownEditor, { ...props, documentKey: "two.md", initialContent: "新文档" })));
    expect(view.state.doc.toString()).toBe("新文档");
    expect(view.state.selection.main.head).toBe(0);
    expect(view.scrollDOM.scrollTop).toBe(0);
  });
});
