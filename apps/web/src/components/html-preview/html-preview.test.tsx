// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { HtmlPreview } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TooltipProvider } from "../ui/tooltip.js";
import { AgentMarkdown, renderAgentMarkdown } from "../markdown/agent-markdown.js";
import { HtmlFilePreview, HtmlPreviewScope } from "./html-preview-card.js";

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
    request = vi.spyOn(client, "htmlPreview").mockImplementation(input => Promise.resolve(input.kind === "code" || input.kind === "file" ? result : null));
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
    await click("预览 HTML");
    expect(request).toHaveBeenCalledWith({ kind: "code", conversationId, html: "<h1>页面</h1>\n" });
    const frame = node.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("src")).toBe(result.url);
    expect(node.querySelector<HTMLElement>(".agent-markdown__code-block > pre")?.hidden).toBe(true);
    await click("源码");
    expect(node.querySelector('section code')?.textContent).toBe(result.source);
    expect(node.querySelector('section h1')).toBeNull();
    await click("在侧边浏览器打开 HTML");
    expect(request).toHaveBeenCalledWith({ kind: "browser", conversationId, id: result.id });
    await click("刷新 HTML 预览");
    expect(request.mock.calls.filter(([input]) => input.kind === "code")).toHaveLength(2);
    await click("关闭 HTML 预览");
    expect(node.querySelector<HTMLElement>(".agent-markdown__code-block > pre")?.hidden).toBe(false);
    expect(request.mock.calls.filter(([input]) => input.kind === "release")).toHaveLength(2);
  });

  it("opens local HTML links, clears previews on message updates and leaves external links alone", async () => {
    await render(<AgentMarkdown content="[页面](pages/demo.html) [官网](https://example.com/demo.html)" />);
    await act(async () => { node.querySelector<HTMLAnchorElement>('a[href="pages/demo.html"]')!.click(); await Promise.resolve(); });
    expect(request).toHaveBeenCalledWith({ kind: "file", conversationId, path: "pages/demo.html" });
    await render(<AgentMarkdown content="更新后的消息" />);
    expect(node.querySelector("iframe")).toBeNull();
    expect(request).toHaveBeenCalledWith({ kind: "release", conversationId, id: result.id });
  });

  it("releases late responses after unmount and lets failed file previews retry", async () => {
    let resolve!: (value: HtmlPreview) => void;
    request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await render(<HtmlFilePreview path="demo.html" />);
    await render(null);
    await act(async () => { resolve(result); await Promise.resolve(); });
    expect(request).toHaveBeenCalledWith({ kind: "release", conversationId, id: result.id });
    request.mockRejectedValueOnce(new Error("文件不存在"));
    await render(<HtmlFilePreview path="demo.html" />);
    expect(node.querySelector('[role="alert"]')?.textContent).toBe("文件不存在");
    await click("刷新 HTML 预览");
    expect(node.querySelector("iframe")).not.toBeNull();
    await click("关闭 HTML 预览");
    await click("预览 HTML：demo.html");
    expect(node.querySelector("iframe")).not.toBeNull();
    await render(<HtmlFilePreview path="demo.txt" />);
    expect(node.querySelector("iframe")).toBeNull();
  });
});
