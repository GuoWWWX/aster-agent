// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./agent-markdown.js";
import { HtmlPreviewCard, HtmlPreviewScope } from "../html-preview/html-preview-card.js";
import { TooltipProvider } from "../ui/tooltip.js";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import * as highlighter from "./code-highlighter.js";
import { MarkdownLayoutScope } from "./markdown-layout-scope.js";

let host: HTMLDivElement, root: Root;
let targets: Map<Element, IntersectionObserverCallback>;
let observedRoots: IntersectionObserverInit["root"][];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  targets = new Map();
  observedRoots = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { observedRoots.push(options?.root); }
    observe(target: Element) { targets.set(target, this.callback); }
    disconnect() {}
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function intersect(target: Element, visible: boolean): Promise<void> {
  await act(async () => { targets.get(target)?.([{ target, isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver); await Promise.resolve(); });
}

it("does not parse or highlight offscreen Markdown, activates near the viewport and retains its DOM", async () => {
  const highlight = vi.spyOn(highlighter, "highlightCode");
  const resized = vi.fn();
  host.dataset.deferredScrollRoot = "";
  await act(async () => { root.render(<MarkdownLayoutScope onResize={resized}><AgentMarkdown content={'```js\nconst x = 1;\n```'} /></MarkdownLayoutScope>); await Promise.resolve(); });
  expect(highlight).not.toHaveBeenCalled();
  expect(resized).not.toHaveBeenCalled();
  expect(observedRoots[0]).toBe(host);
  expect(host.querySelector(".agent-markdown")).toBeNull();
  const target = [...targets.keys()][0]!;
  await intersect(target, true);
  const content = host.querySelector(".agent-markdown");
  expect(content?.textContent).toContain("const x");
  expect(resized).toHaveBeenCalled();
  await intersect(target, false);
  expect(host.querySelector(".agent-markdown")).toBe(content);
});

it("renders streaming output immediately even before an intersection callback", async () => {
  await act(async () => { root.render(<AgentMarkdown content="Streaming reply" streaming />); await Promise.resolve(); });
  expect(host.textContent).toContain("Streaming reply");
  expect(host.querySelector("[data-markdown-pending]")).toBeNull();
});

it("creates a React preview only after its card approaches the viewport and releases it on unmount", async () => {
  const client = new MockAgentClient();
  const request = vi.spyOn(client, "htmlPreview").mockImplementation(input => Promise.resolve(input.kind === "code"
    ? { id: "preview", title: "React", url: "http://127.0.0.1/preview", source: input.html } : null));
  await act(async () => { root.render(<TooltipProvider><HtmlPreviewScope client={client} conversationId="conversation"><HtmlPreviewCard source={{ kind: "code", language: "react", html: "export default () => <p>Hello</p>" }} /></HtmlPreviewScope></TooltipProvider>); await Promise.resolve(); });
  expect(request).not.toHaveBeenCalled();
  await intersect(host.querySelector("section")!, true);
  expect(request.mock.calls.filter(([input]) => input.kind === "code")).toHaveLength(1);
  expect(host.querySelectorAll("iframe")).toHaveLength(1);
  await act(async () => { root.render(null); await Promise.resolve(); });
  expect(request).toHaveBeenCalledWith({ kind: "release", id: "preview", conversationId: "conversation" });
});
