// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { HtmlPreview } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TooltipProvider } from "../ui/tooltip.js";
import { AgentMarkdown, renderAgentMarkdown } from "../markdown/agent-markdown.js";
import * as highlighter from "../markdown/code-highlighter.js";
import { HtmlPreviewCard, HtmlPreviewScope } from "./html-preview-card.js";

const conversationId = "00000000-0000-4000-8000-000000000001";
const result: HtmlPreview = { id: conversationId, title: "demo.html", url: "http://127.0.0.1:1234/token/demo.html", source: "<h1>页面</h1>" };
describe("conversation HTML previews", () => {
  let root: Root;
  let node: HTMLDivElement;
  let client: MockAgentClient;
  let request: MockInstance<MockAgentClient["htmlPreview"]>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    node = document.createElement("div"); document.body.append(node); root = createRoot(node);
    client = new MockAgentClient();
    request = vi.spyOn(client, "htmlPreview").mockImplementation(input => Promise.resolve(input.kind === "code" ? { ...result, source: input.html } : input.kind === "file" ? result : null));
  });
  afterEach(() => { act(() => root.unmount()); node.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function render(children: ReactNode): Promise<void> {
    await act(async () => { root.render(<TooltipProvider><HtmlPreviewScope client={client} conversationId={conversationId}>{children}</HtmlPreviewScope></TooltipProvider>); await Promise.resolve(); });
  }
  async function click(label: string): Promise<void> {
    const button = [...node.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === label || button.textContent === label);
    expect(button, label).toBeDefined();
    await act(async () => { button!.click(); await Promise.resolve(); });
  }

  it("offers code preview only for closed HTML fences in a conversation", async () => {
    expect(renderAgentMarkdown("```html\n<h1>页面</h1>\n``` ")).not.toContain("preview-html");
    await render(<AgentMarkdown content={"```html\n<h1>页面</h1>"} />);
    expect(node.querySelector('[data-action="preview-html"]')).toBeNull();
    await render(<AgentMarkdown content={"```html\n<h1>页面</h1>\n```"} />);
    const block = node.querySelector(".agent-markdown__code-block");
    expect(block?.querySelectorAll("header")).toHaveLength(1);
    expect(block?.querySelector(".cm-content")?.textContent).toBe("<h1>页面</h1>");
    expect(request).not.toHaveBeenCalled();
    await click("预览 HTML");
    expect(request).toHaveBeenCalledWith({ kind: "code", conversationId, html: "<h1>页面</h1>\n" });
    const frame = node.querySelector("iframe");
    act(() => { frame!.dispatchEvent(new Event("load")); });
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("src")).toBe(result.url);
    expect(block?.querySelectorAll("header")).toHaveLength(1);
    expect(block?.querySelector("section section")).toBeNull();
    expect(block?.querySelector("pre")).toBeNull();
    expect(block?.querySelector('[aria-label="显示源码"] .lucide-code-xml')).not.toBeNull();
    expect(block?.querySelector('[aria-label="刷新 HTML 预览"]')).toBeNull();
    await click("显示源码");
    expect(node.querySelector('.cm-content')?.textContent).toBe("<h1>页面</h1>");
    expect(node.querySelector('section h1')).toBeNull();
    expect(node.querySelector("iframe")).toBeNull();
    await click("在侧边浏览器打开 HTML");
    expect(request).toHaveBeenCalledWith({ kind: "browser", conversationId, id: result.id });
    expect(block?.querySelector('[aria-label="预览 HTML"] .lucide-play')).not.toBeNull();
    await click("预览 HTML");
    expect(request.mock.calls.filter(([input]) => input.kind === "code")).toHaveLength(2);
    expect(node.querySelector('[aria-label="关闭 HTML 预览"]')).toBeNull();
    expect(block?.querySelector(".cm-editor")).toBeNull();
    expect(block?.querySelectorAll("header")).toHaveLength(1);
    expect(request.mock.calls.filter(([input]) => input.kind === "release")).toHaveLength(1);
  });

  it("does not treat a Markdown file marker as a presentation tool call", async () => {
    const content = "页面已保存。\n\n```html-preview\npages/demo.html\n```";
    await render(<AgentMarkdown content={content} />);
    expect(request).not.toHaveBeenCalled();
    expect(node.querySelector("iframe")).toBeNull();
    expect(node.querySelector("code")?.textContent).toBe("pages/demo.html\n");
  });

  it("keeps loading feedback after the preview URL is created until the frame is ready", async () => {
    await render(<HtmlPreviewCard source={{ kind: "code", html: "<p>页面</p>" }} initialMode="source" />);
    await click("预览 HTML");
    const frame = node.querySelector("iframe")!;
    expect(node.querySelector('[role="status"]')?.textContent).toContain("正在加载页面");
    expect(node.querySelector('[role="status"] .app-loading-bone')).not.toBeNull();
    expect(node.querySelector('[aria-label="显示源码"]')?.getAttribute("aria-busy")).toBe("true");
    act(() => { frame.dispatchEvent(new Event("load")); });
    expect(node.querySelector('[role="status"]')).toBeNull();
    expect(node.querySelector('[aria-label="显示源码"]')?.getAttribute("aria-busy")).toBe("false");
    await click("显示源码");
    await click("预览 HTML");
    expect(node.querySelector('[role="status"]')).not.toBeNull();
    await click("显示源码");
    expect(node.querySelector("iframe")).toBeNull();
    expect(node.querySelector('[role="status"]')).toBeNull();
    expect(node.querySelector(".cm-content")?.textContent).toBe("<p>页面</p>");
  });

  it("clears loading feedback on its own usable size report without waiting for all page resources", async () => {
    await render(<HtmlPreviewCard source={{ kind: "code", html: "<p>页面</p>" }} />);
    const frame = node.querySelector("iframe")!;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 720, 320));
    const message = (source: MessageEventSource | null): void => {
      act(() => { window.dispatchEvent(new MessageEvent("message", { source, origin: "null", data: { type: "html-preview.resize", id: result.id, height: 40 } })); });
    };
    message(window);
    expect(node.querySelector('[role="status"]')).not.toBeNull();
    message(frame.contentWindow);
    expect(node.querySelector('[role="status"]')).toBeNull();
    expect(frame.style.height).toBe("40px");
  });

  it("shows a one-line HTML source without a trailing blank line and copies the original", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const source = "<p>一行内容</p>\n";
    await render(<HtmlPreviewCard source={{ kind: "code", html: source }} initialMode="source" />);
    expect(node.querySelectorAll(".cm-line")).toHaveLength(1);
    expect(node.querySelector(".cm-line")?.textContent).toBe("<p>一行内容</p>");
    await click("复制代码");
    expect(writeText).toHaveBeenCalledWith(source);
  });

  it("uses a bounded read-only source viewport for a large HTML block and copies its complete source", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const source = '<g class="pelican"><circle cx="30" cy="40" r="20"/></g>\n'.repeat(1000);
    await render(<AgentMarkdown content={"```html\n" + source + "```"} />);
    expect(node.querySelector(".cm-editor")).not.toBeNull();
    expect(node.querySelector('[contenteditable="true"]')).toBeNull();
    await click("复制代码");
    expect(writeText).toHaveBeenCalledWith(source);
    expect(request).not.toHaveBeenCalled();
    await click("预览 HTML");
    expect(node.querySelector(".cm-editor")).toBeNull();
    expect(node.querySelector("iframe")).not.toBeNull();
  });

  it("reuses a highlighted HTML source editor across unrelated parent updates", async () => {
    const highlight = vi.spyOn(highlighter, "highlightCode");
    const content = "```html\n<h1>示例</h1>\n```";
    await render(<AgentMarkdown content={content} />);
    const editor = node.querySelector(".cm-editor");
    expect(editor).not.toBeNull();
    expect(editor?.querySelector(".cm-line span[class]")).not.toBeNull();
    await render(<AgentMarkdown content={content} />);
    expect(node.querySelector(".cm-editor")).toBe(editor);
    expect(highlight).not.toHaveBeenCalled();
  });

  it("switches each HTML fence independently without nesting cards or losing copy", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render(<AgentMarkdown content={"```html\n<p>第一个</p>\n```\n\n```html\n<p>第二个</p>\n```"} />);
    const blocks = node.querySelectorAll(".agent-markdown__code-block");
    expect(blocks).toHaveLength(2);
    await act(async () => { blocks[0]!.querySelector<HTMLButtonElement>('[aria-label="预览 HTML"]')!.click(); await Promise.resolve(); });
    expect(blocks[0]!.querySelector("iframe")).not.toBeNull();
    expect(blocks[0]!.querySelector("pre")).toBeNull();
    expect(blocks[1]!.querySelector(".cm-content")?.textContent).toBe("<p>第二个</p>");
    await act(async () => { blocks[0]!.querySelector<HTMLButtonElement>('[aria-label="复制代码"]')!.click(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith("<p>第一个</p>\n");
    expect([...blocks].every(block => block.querySelectorAll("header").length === 1)).toBe(true);
  });

  it("opens local HTML links, clears previews on message updates and leaves external links alone", async () => {
    await render(<AgentMarkdown content="[页面](pages/demo.html) [官网](https://example.com/demo.html)" />);
    await act(async () => { node.querySelector<HTMLAnchorElement>('a[href="pages/demo.html"]')!.click(); await Promise.resolve(); });
    expect(request).toHaveBeenCalledWith({ kind: "file", conversationId, path: "pages/demo.html" });
    await render(<AgentMarkdown content="更新后的消息" />);
    expect(node.querySelector("iframe")).toBeNull();
    expect(request).toHaveBeenCalledWith({ kind: "release", conversationId, id: result.id });
  });

  it("fits natural content within the preview height limits and only accepts messages from its own sandbox", async () => {
    await render(<HtmlPreviewCard source={{ kind: "file", path: "demo.html" }} />);
    const frame = node.querySelector("iframe")!;
    const bounds = vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 720, 320));
    const resize = (height: unknown, source: MessageEventSource | null = frame.contentWindow, id = result.id, origin = "null"): void => {
      act(() => { window.dispatchEvent(new MessageEvent("message", { source, origin, data: { type: "html-preview.resize", id, height } })); });
    };
    resize(80);
    expect(frame.style.height).toBe("80px");
    resize(24);
    expect(frame.style.height).toBe("24px");
    resize(360);
    expect(frame.style.height).toBe("360px");
    resize(20_000);
    expect(frame.style.height).toBe("520px");
    resize(360);
    bounds.mockReturnValue(new DOMRect());
    resize(1);
    expect(frame.style.height).toBe("360px");
    bounds.mockReturnValue(new DOMRect(0, 0, 720, 720));
    for (const height of [-1, 0, 1_000_000, NaN, "900"]) resize(height);
    resize(900, window);
    resize(900, frame.contentWindow, "00000000-0000-4000-8000-000000000099");
    resize(900, frame.contentWindow, result.id, "https://example.com");
    expect(frame.style.height).toBe("360px");
    resize(430);
    expect(frame.style.height).toBe("430px");
    expect(frame.parentElement?.className).not.toContain("resize-y");
    await click("显示源码");
    await click("预览 HTML");
    resize(999);
    expect(node.querySelector("iframe")?.style.height).not.toBe("999px");
  });

  it("remeasures a cached preview when its container becomes visible without recreating it", async () => {
    let callback: ResizeObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(next: ResizeObserverCallback) { callback = next; }
      observe() {}
      disconnect = disconnect;
    });
    await render(<HtmlPreviewCard source={{ kind: "file", path: "demo.html" }} />);
    const frame = node.querySelector("iframe")!;
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    const observer: ResizeObserver = { observe() {}, unobserve() {}, disconnect };
    const notify = (width: number): void => {
      act(() => callback([{ contentRect: new DOMRect(0, 0, width, 320), target: frame, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], observer));
    };
    notify(720);
    expect(post).toHaveBeenLastCalledWith({ type: "html-preview.measure", id: result.id }, "*");
    post.mockClear();
    notify(0);
    expect(post).not.toHaveBeenCalled();
    notify(720);
    expect(post).toHaveBeenCalledTimes(1);
    notify(720);
    expect(post).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter(([input]) => input.kind === "file")).toHaveLength(1);
    await click("显示源码");
    expect(disconnect).toHaveBeenCalled();
  });

  it("releases late responses after unmount and lets failed file previews retry", async () => {
    let resolve!: (value: HtmlPreview) => void;
    request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await render(<HtmlPreviewCard source={{ kind: "file", path: "demo.html" }} />);
    await render(null);
    await act(async () => { resolve(result); await Promise.resolve(); });
    expect(request).toHaveBeenCalledWith({ kind: "release", conversationId, id: result.id });
    request.mockRejectedValueOnce(new Error("文件不存在"));
    await render(<HtmlPreviewCard source={{ kind: "file", path: "demo.html" }} />);
    expect(node.querySelector('header [aria-label="HTML 预览错误"]')).not.toBeNull();
    expect(node.querySelector('[role="alert"]')).toBeNull();
    await click("显示源码");
    await click("预览 HTML");
    expect(node.querySelector("iframe")).not.toBeNull();
    await click("显示源码");
    expect(node.querySelector("iframe")).toBeNull();
    await click("预览 HTML");
    expect(node.querySelector("iframe")).not.toBeNull();
  });

  it("keeps browser errors in a focusable title action and clears them after retry", async () => {
    const message = "The workspace did not confirm that the browser tab was opened in time.";
    await render(<HtmlPreviewCard source={{ kind: "file", path: "demo.html" }} />);
    request.mockRejectedValueOnce(new Error(message));
    await click("在侧边浏览器打开 HTML");
    const error = node.querySelector<HTMLButtonElement>('header [aria-label="HTML 预览错误"]');
    expect(error).not.toBeNull();
    expect(error?.nextElementSibling?.getAttribute("aria-label")).toBe("显示源码");
    expect(node.querySelector('[role="alert"]')).toBeNull();
    expect(node.querySelector("iframe")?.getAttribute("src")).toBe(result.url);
    await act(async () => { error!.focus(); await Promise.resolve(); });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(message);
    await click("在侧边浏览器打开 HTML");
    expect(node.querySelector('[aria-label="HTML 预览错误"]')).toBeNull();
  });

  it("highlights a large HTML document without generating the whole document as DOM", async () => {
    const source = '<style>.card { color: red }</style>\n<script>const count = 42;</script>\n' + '<div class="card">内容</div>\n'.repeat(1000);
    await render(<HtmlPreviewCard source={{ kind: "code", html: source }} initialMode="source" />);
    expect(node.querySelector(".cm-line span[class]")).not.toBeNull();
    expect(node.querySelectorAll(".cm-line").length).toBeLessThan(200);
    expect(node.querySelector('[contenteditable="true"]')).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("marks browser opening immediately and prevents duplicate requests until it settles", async () => {
    await render(<HtmlPreviewCard source={{ kind: "file", path: "demo.html" }} />);
    let finish!: () => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(null); }));
    await click("在侧边浏览器打开 HTML");
    const button = node.querySelector<HTMLButtonElement>('[aria-label="在侧边浏览器打开 HTML"]');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");
    await click("在侧边浏览器打开 HTML");
    expect(request.mock.calls.filter(([input]) => input.kind === "browser")).toHaveLength(1);
    await act(async () => { finish(); await Promise.resolve(); });
    const settled = node.querySelector<HTMLButtonElement>('[aria-label="在侧边浏览器打开 HTML"]');
    expect(settled?.disabled).toBe(false);
    expect(settled?.getAttribute("aria-busy")).toBe("false");
  });
});
