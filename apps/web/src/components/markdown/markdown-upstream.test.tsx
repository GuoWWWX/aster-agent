// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
const fakeRender = vi.hoisted(() => vi.fn((_source: string, dark: boolean) => Promise.resolve({
  svg: `<svg viewBox="0 0 100 50" data-theme-result="${dark ? "dark" : "light"}"></svg>`, width: 100, height: 50,
})));
const fakePng = vi.hoisted(() => vi.fn().mockResolvedValue("data:image/png;base64,aW1hZ2U="));
vi.mock("../../lib/mermaid.js", async (original) => ({ ...await original<typeof import("../../lib/mermaid.js")>(), renderMermaid: fakeRender, mermaidToPngDataUrl: fakePng }));
import { AgentMarkdown, renderAgentMarkdown } from "./agent-markdown.js";

function preview(source: string): HTMLDivElement {
  const node = document.createElement("div");
  node.innerHTML = renderAgentMarkdown(source);
  return node;
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("MDKing features in conversation Markdown", () => {
  it("uses the shared grammar for math in text, quotes, short-divided tables and escaped delimiters", () => {
    const node = preview("**延迟：**20 $\\text{\\mu s}$\n\n> $$\n> x^2 + y^2 = z^2\n> $$\n\n| 公式 | 值 |\n| - | -- |\n| $|x|$ | \\(a+b\\) |\n\n\\$5 and \\$10\n\n```text\n$x$\n```");
    expect(node.querySelectorAll(".katex")).toHaveLength(4);
    expect(node.querySelector(".katex-error")).toBeNull();
    expect(node.querySelector("blockquote .agent-markdown__math-block")).not.toBeNull();
    expect(node.querySelectorAll("tbody td")).toHaveLength(2);
    expect(node.querySelector("strong")?.textContent).toBe("延迟：");
    expect(node.querySelector("pre")?.textContent).toBe("$x$\n");
    expect(node.textContent).toContain("$5 and $10");
  });
  it("renders safe HTML typography while removing executable tags, attributes and URLs", () => {
    const node = preview('<kbd onclick="alert(1)">Ctrl</kbd> H<sub>2</sub>O <mark style="position:fixed">重点</mark> <a href="javascript:alert(1)">链接</a> <img src="https://example.com/a.png" onerror="alert(1)"> <script>alert(1)</script> <iframe srcdoc="x"></iframe> <svg onload="alert(1)"></svg>');
    expect(node.querySelector("kbd")?.textContent).toBe("Ctrl");
    expect(node.querySelector("sub")?.textContent).toBe("2");
    expect(node.querySelector("mark")?.getAttribute("style")).toBeNull();
    expect(node.querySelector("a")?.getAttribute("href")).toBeNull();
    expect(node.querySelector("img")?.getAttribute("onerror")).toBeNull();
    expect(node.querySelector("[onclick],script,iframe,svg")).toBeNull();
    expect(preview('\\<kbd>代码\\</kbd>').querySelector("kbd")).toBeNull();
    expect(preview('`<kbd>Ctrl</kbd>`').querySelector("kbd")).toBeNull();
  });
  it("renders folded callouts with colored custom titles and preserves ordinary quotes", () => {
    const node = preview("> [!warning]- **风险**\n> 检查配置\n\n> [!tip]+ 提示\n> 使用缓存\n\n> 普通引用");
    const callouts = node.querySelectorAll("details.agent-markdown__callout");
    expect(callouts).toHaveLength(2);
    expect(callouts[0]?.hasAttribute("open")).toBe(false);
    expect(callouts[0]?.querySelector("summary strong")?.textContent).toBe("风险");
    expect(callouts[0]?.getAttribute("data-tone")).toBe("amber");
    expect(callouts[1]?.hasAttribute("open")).toBe(true);
    expect(node.querySelector("blockquote")?.textContent).toContain("普通引用");
    expect(node.textContent).not.toContain("[!warning]");
  });
  it("keeps nested callouts balanced", () => {
    const node = preview("> [!note] 外层\n> 正文\n>\n> > [!tip] 内层\n> > 提示\n\n结束");
    expect(node.querySelector("aside aside")?.textContent).toContain("提示");
    expect(node.querySelector("aside")?.textContent).not.toContain("结束");
  });
  it("absorbs table, image and Mermaid captions without duplicating their text", () => {
    const node = preview("| A | B |\n| - | - |\n| 1 | 2 |\n**表1 示例**\n\n![示例](assets/a.png)\n**图1 示例**\n\n```mermaid {caption=\"流程\"}\nflowchart lr\nA-->B\n```");
    expect(node.querySelector("caption")?.textContent).toBe("表1 示例");
    expect(node.querySelector("figcaption")?.textContent).toBe("图1 示例");
    expect(node.querySelector(".agent-markdown__mermaid-caption")?.textContent).toBe("流程");
    expect(node.textContent?.match(/表1 示例/g)).toHaveLength(1);
    expect(node.textContent?.match(/图1 示例/g)).toHaveLength(1);
  });
  it("does not associate an inline image with the next standalone caption", () => {
    const node = preview("行内 ![A](a.png) 图片\n\n> ![引用图片](quote.png)\n\n![B](b.png)\n**图 B**");
    expect(node.querySelector("figure img")?.getAttribute("src")).toBe("b.png");
    expect(node.querySelectorAll("figure")).toHaveLength(1);
  });
  it("only consumes adjacent Mermaid captions and gives native captions priority", () => {
    const node = preview("**独立正文**\n\n```mermaid\nA-->B\n```\n\n**后续正文**");
    expect(node.querySelector(".agent-markdown__mermaid-caption")).toBeNull();
    expect(node.querySelectorAll("p strong")).toHaveLength(2);
    const explicit = preview('**保留正文**\n```mermaid {caption="指定题注"}\nA-->B\n```');
    expect(explicit.querySelector("p strong")?.textContent).toBe("保留正文");
    expect(explicit.querySelector(".agent-markdown__mermaid-caption")?.textContent).toBe("指定题注");
  });
  it("accepts adjacent bold Mermaid captions and unnumbered headings", () => {
    const node = preview("## 说明 {-}\n\n**图2 流程**\n```mermaid\nflowchart LR\nA-->B\n```");
    expect(node.querySelector("h2")?.textContent).toBe("说明");
    expect(node.querySelector(".agent-markdown__mermaid-caption")?.textContent).toBe("图2 流程");
  });
  it("keeps streaming or short-closing Mermaid fences as source until complete", () => {
    expect(preview("```mermaid\nflowchart LR\nA-->B").querySelector(".agent-markdown__mermaid")).toBeNull();
    expect(preview("````mermaid\nflowchart LR\nA-->B\n```").querySelector(".agent-markdown__mermaid")).toBeNull();
    expect(preview("> ```mermaid\n> flowchart LR\n> A-->B\n> ```").querySelector(".agent-markdown__mermaid")).not.toBeNull();
  });
  it("renders diagrams, exposes their source, copies it and retains the canvas while changing theme", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    useWorkbenchUiStore.setState({ themeMode: "light" });
    const node = document.createElement("div"); document.body.append(node);
    const root = createRoot(node);
    const source = "flowchart LR\nA-->B\n";
    await act(async () => { root.render(createElement(AgentMarkdown, { content: "```mermaid\n" + source + "```" })); await Promise.resolve(); });
    expect(node.querySelector("svg[data-theme-result='light']")).not.toBeNull();
    const canvas = node.querySelector<HTMLElement>("[data-mermaid-canvas]");
    act(() => node.querySelector<HTMLButtonElement>("[data-action='toggle-mermaid-source']")?.click());
    expect(node.querySelector<HTMLPreElement>("[data-mermaid-source]")?.hidden).toBe(false);
    expect(canvas?.hidden).toBe(true);
    await act(async () => { node.querySelector<HTMLButtonElement>("[data-action='copy-mermaid']")?.click(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith(source);
    await act(async () => { useWorkbenchUiStore.setState({ themeMode: "dark" }); await Promise.resolve(); });
    expect(node.querySelector("[data-mermaid-canvas]")).toBe(canvas);
    expect(node.querySelector("svg[data-theme-result='dark']")).not.toBeNull();
    act(() => node.querySelector<HTMLButtonElement>("[data-action='toggle-mermaid-source']")?.click());
    expect(node.querySelector<HTMLPreElement>("[data-mermaid-source]")?.hidden).toBe(true);
    expect(canvas?.hidden).toBe(false);
    act(() => root.unmount()); node.remove();
  });
  it("opens the rendered diagram rather than a toolbar icon in the image viewer", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const node = document.createElement("div"); document.body.append(node);
    const root = createRoot(node);
    await act(async () => { root.render(createElement(AgentMarkdown, { content: "```mermaid\nflowchart LR\nA-->B\n```" })); await Promise.resolve(); });
    const request = vi.fn();
    window.addEventListener("md-king:open-media-preview", request);
    act(() => node.querySelector<HTMLButtonElement>("[data-action='preview-mermaid']")?.click());
    const event = request.mock.calls[0]?.[0] as CustomEvent<{ src: string }>;
    expect(decodeURIComponent(event.detail.src)).toContain('data-theme-result="');
    expect(decodeURIComponent(event.detail.src)).not.toContain("lucide-maximize");
    window.removeEventListener("md-king:open-media-preview", request);
    act(() => root.unmount()); node.remove();
  });
  it("copies a PNG from the diagram menu and keeps a failed copy available for retry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const write = vi.fn<(items: Array<{ data: Record<string, Promise<Blob>> }>) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Clipboard unavailable")).mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal("ClipboardItem", class {
      constructor(readonly data: Record<string, Promise<Blob>>) {}
    });
    const png = new Blob(["image"], { type: "image/png" });
    const fetchPng = vi.fn().mockResolvedValue({ blob: () => Promise.resolve(png) });
    vi.stubGlobal("fetch", fetchPng);
    useWorkbenchUiStore.setState({ themeMode: "dark" });
    const node = document.createElement("div"); document.body.append(node);
    const root = createRoot(node);
    const source = "flowchart LR\nA-->B\n";
    try {
      await act(async () => { root.render(createElement(AgentMarkdown, { content: "```mermaid\n" + source + "```" })); await Promise.resolve(); });
      act(() => { node.querySelector(".agent-markdown__code-header")?.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true })); });
      expect(document.querySelector("[role=menu]")).toBeNull();
      act(() => { node.querySelector("[data-mermaid-canvas] svg")?.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 80 })); });
      const copy = document.querySelector<HTMLButtonElement>("[role=menuitem]");
      expect(copy?.textContent).toBe("复制图片");
      await act(async () => { copy?.click(); await Promise.resolve(); });
      expect(document.querySelector("[role=status]")?.textContent).toContain("无法复制图表图片");
      expect(copy?.disabled).toBe(false);
      await act(async () => { copy?.click(); await Promise.resolve(); });
      expect(fakePng).toHaveBeenLastCalledWith(source, true);
      expect(fetchPng).toHaveBeenCalledWith("data:image/png;base64,aW1hZ2U=");
      expect(write).toHaveBeenCalledTimes(2);
      expect(await write.mock.calls[1]?.[0][0]?.data["image/png"]).toBe(png);
      expect(document.querySelector("[role=menu]")).toBeNull();
    } finally { act(() => root.unmount()); node.remove(); }
  });
});
