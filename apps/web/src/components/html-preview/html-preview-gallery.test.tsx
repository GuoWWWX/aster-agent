// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TooltipProvider } from "../ui/tooltip.js";
import { HtmlPreviewScope } from "./html-preview-card.js";
import { HtmlPreviewGallery } from "./html-preview-gallery.js";

const conversationId = "00000000-0000-4000-8000-000000000001";
const pages = [{ title: "A", kind: "code" as const, html: "<button>A</button>" }, { title: "B", kind: "code" as const, html: "<button>B</button>" }];
let root: Root;
let host: HTMLDivElement;
let client: MockAgentClient;
let request: MockInstance<MockAgentClient["htmlPreview"]>;
let visibility: Map<Element, (visible: boolean) => void>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  visibility = new Map();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element): void { visibility.set(target, visible => this.callback([{ target, isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver)); }
    disconnect(): void {}
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new MockAgentClient();
  let sequence = 0;
  request = vi.spyOn(client, "htmlPreview").mockImplementation(input => Promise.resolve(input.kind === "code" ? {
    id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`, title: "demo", source: input.html, url: `http://127.0.0.1/${sequence}`,
  } : null));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(): Promise<void> {
  await act(async () => { root.render(<TooltipProvider><HtmlPreviewScope client={client} conversationId={conversationId}><HtmlPreviewGallery pages={pages} cacheTtlMs={1000} /></HtmlPreviewScope></TooltipProvider>); await Promise.resolve(); });
}
async function click(label: string): Promise<void> { await act(async () => { host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(); await Promise.resolve(); }); }
function show(target: Element, visible: boolean): void { act(() => { visibility.get(target)!(visible); }); }
async function elapse(ms: number): Promise<void> { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function creates(): number { return request.mock.calls.filter(([input]) => input.kind === "code").length; }
function releases(): number { return request.mock.calls.filter(([input]) => input.kind === "release").length; }

it("reuses the same loaded iframe when returning to an option", async () => {
  await render();
  const first = host.querySelector("iframe")!;
  act(() => { first.dispatchEvent(new Event("load")); });
  await click("下一个方案");
  await click("上一个方案");
  expect(host.querySelector("iframe")).toBe(first);
  expect(creates()).toBe(2);
  expect(releases()).toBe(0);
  expect(first.closest("[hidden]")).toBeNull();
  expect(first.parentElement?.querySelector('[role="status"]')).toBeNull();
});

it("reserves the previous height while loading, then follows each option's natural height", async () => {
  await render();
  const first = host.querySelector("iframe")!;
  vi.spyOn(first, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 720, 320));
  act(() => { window.dispatchEvent(new MessageEvent("message", { source: first.contentWindow, origin: "null", data: { type: "html-preview.resize", id: conversationId, height: 420 } })); });
  await click("下一个方案");
  const second = host.querySelectorAll("iframe")[1]!;
  expect(second.style.height).toBe("420px");
  expect(second.parentElement?.querySelector('[role="status"]')).not.toBeNull();
  vi.spyOn(second, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 720, 420));
  act(() => { window.dispatchEvent(new MessageEvent("message", { source: second.contentWindow, origin: "null", data: { type: "html-preview.resize", id: "00000000-0000-4000-8000-000000000002", height: 160 } })); });
  expect(second.style.height).toBe("160px");
  await click("上一个方案");
  expect(first.style.height).toBe("420px");
});

it("lets source view shrink to its code content instead of reserving the preview height", async () => {
  await render();
  const frame = host.querySelector("iframe")!;
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 720, 320));
  act(() => { window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { type: "html-preview.resize", id: conversationId, height: 420 } })); });
  await click("显示源码");
  expect(host.querySelector('[data-virtual-code-source]')?.parentElement?.style.height).not.toBe("420px");
});

it("expires hidden options while keeping a visible option alive, then reloads on return", async () => {
  await render();
  const first = host.querySelector("iframe")!;
  const firstSlot = [...visibility.keys()][0]!;
  await click("下一个方案");
  show(firstSlot, false);
  await elapse(1001);
  expect(first.isConnected).toBe(false);
  expect(releases()).toBe(1);
  expect(host.querySelectorAll("iframe")).toHaveLength(1);
  await click("上一个方案");
  show(firstSlot, true);
  await act(async () => { await Promise.resolve(); });
  expect(creates()).toBe(3);
});

it("releases an expired visible option only after it leaves the viewport and reloads on scroll back", async () => {
  await render();
  const slot = [...visibility.keys()][0]!;
  await elapse(1001);
  expect(releases()).toBe(0);
  show(slot, false);
  await act(async () => { await Promise.resolve(); });
  expect(releases()).toBe(1);
  expect(host.querySelector("iframe")).toBeNull();
  show(slot, true);
  await act(async () => { await Promise.resolve(); });
  expect(creates()).toBe(2);
});

it("releases all visited options when the conversation page is removed", async () => {
  await render(); await click("下一个方案");
  await act(async () => { root.render(null); await Promise.resolve(); });
  expect(releases()).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
});
