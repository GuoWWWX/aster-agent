// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { HtmlPreview } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TooltipProvider } from "../ui/tooltip.js";
import { AgentMarkdown, renderAgentMarkdown } from "../markdown/agent-markdown.js";
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
    node = document.createElement("div"); document.body.append(node); root = createRoot(node);
    client = new MockAgentClient();
    request = vi.spyOn(client, "htmlPreview").mockImplementation(input => Promise.resolve(input.kind === "code" ? { ...result, source: input.html } : input.kind === "file" ? result : null));
  });
  afterEach(() => { act(() => root.unmount()); node.remove(); vi.unstubAllGlobals(); });
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
    expect(block?.querySelector("pre")?.textContent).toBe("<h1>页面</h1>\n");
    expect(request).not.toHaveBeenCalled();
    await click("预览 HTML");
    expect(request).toHaveBeenCalledWith({ kind: "code", conversationId, html: "<h1>页面</h1>\n" });
    const frame = node.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("src")).toBe(result.url);
    expect(block?.querySelectorAll("header")).toHaveLength(1);
    expect(block?.querySelector("section section")).toBeNull();
    expect(block?.querySelector("pre")).toBeNull();
    await click("源码");
    expect(node.querySelector('section code')?.textContent).toBe("<h1>页面</h1>\n");
    expect(node.querySelector('section h1')).toBeNull();
    expect(node.querySelector("iframe")).toBeNull();
    await click("在侧边浏览器打开 HTML");
    expect(request).toHaveBeenCalledWith({ kind: "browser", conversationId, id: result.id });
    await click("刷新 HTML 预览");
    expect(request.mock.calls.filter(([input]) => input.kind === "code")).toHaveLength(2);
    expect(node.querySelector('[aria-label="关闭 HTML 预览"]')).toBeNull();
    expect(block?.querySelector("pre")?.textContent).toBe("<h1>页面</h1>\n");
    expect(block?.querySelectorAll("header")).toHaveLength(1);
    expect(request.mock.calls.filter(([input]) => input.kind === "release")).toHaveLength(1);
  });

  it("presents complete final HTML without loading incomplete or intermediate output", async () => {
    const content = "```html\n<h1>页面</h1>\n```";
    await render(<AgentMarkdown content={content} />);
    expect(request).not.toHaveBeenCalled();
    await render(<AgentMarkdown content={content} presentHtml />);
    expect(node.querySelector("iframe")).not.toBeNull();
    expect(node.querySelector("pre")).toBeNull();
    await render(<AgentMarkdown content={"```html\n<h1>未结束"} presentHtml />);
    expect(node.querySelector("iframe")).toBeNull();
    expect(request.mock.calls.filter(([input]) => input.kind === "code")).toHaveLength(1);
  });

  it("presents a saved file only through an explicit final HTML reference", async () => {
    const content = "页面已保存。\n\n```html-preview\npages/demo.html\n```";
    await render(<AgentMarkdown content={content} />);
    expect(request).not.toHaveBeenCalled();
    await render(<AgentMarkdown content={content} presentHtml />);
    expect(request).toHaveBeenCalledWith({ kind: "file", conversationId, path: "pages/demo.html" });
    expect(node.querySelectorAll("iframe")).toHaveLength(1);
    await click("源码");
    expect(node.querySelector("code")?.textContent).toBe(result.source);
    expect(node.querySelector("iframe")).toBeNull();
    await render(<AgentMarkdown content={"```html-preview\nhttps://example.com/demo.html\n```"} presentHtml />);
    expect(node.querySelector("iframe")).toBeNull();
    expect(request.mock.calls.filter(([input]) => input.kind === "file")).toHaveLength(1);
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
    expect(blocks[1]!.querySelector("pre")?.textContent).toBe("<p>第二个</p>\n");
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

  it("fits reported content height and only accepts bounded messages from its own sandbox", async () => {
    await render(<HtmlPreviewCard source={{ kind: "file", path: "demo.html" }} />);
    const frame = node.querySelector("iframe")!;
    const resize = (height: unknown, source: MessageEventSource | null = frame.contentWindow, id = result.id, origin = "null"): void => {
      act(() => { window.dispatchEvent(new MessageEvent("message", { source, origin, data: { type: "html-preview.resize", id, height } })); });
    };
    resize(720);
    expect(frame.style.height).toBe("720px");
    for (const height of [-1, 0, 1_000_000, NaN, "900"]) resize(height);
    resize(900, window);
    resize(900, frame.contentWindow, "00000000-0000-4000-8000-000000000099");
    resize(900, frame.contentWindow, result.id, "https://example.com");
    expect(frame.style.height).toBe("720px");
    resize(430);
    expect(frame.style.height).toBe("430px");
    expect(frame.parentElement?.className).not.toContain("resize-y");
    await click("刷新 HTML 预览");
    resize(999);
    expect(node.querySelector("iframe")?.style.height).not.toBe("999px");
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
    expect(node.querySelector('[role="alert"]')?.textContent).toBe("文件不存在");
    await click("刷新 HTML 预览");
    expect(node.querySelector("iframe")).not.toBeNull();
    await click("源码");
    expect(node.querySelector("iframe")).toBeNull();
    await click("预览");
    expect(node.querySelector("iframe")).not.toBeNull();
  });
});
