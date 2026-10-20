// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TeamChatPanel } from "./team-chat-panel.js";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let notifyResize: () => void;
let sequence: number;
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) {}
    observe(target: Element): void { if (target.hasAttribute("data-group-message-list")) notifyResize = this.callback; }
    unobserve(): void {}
    disconnect(): void {}
  });
  sequence = 0; frames.clear(); notifyResize = () => {};
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++sequence, callback); return sequence; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function nextFrame(): void { act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); }); }
async function fixture() {
  const client = new MockAgentClient(); const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  await client.postTeamChat({ teamInstanceId: instance.id, content: "群消息", intent: "notify", requestId: crypto.randomUUID() });
  const mark = vi.spyOn(client, "markTeamChatRead");
  const show = async (active: boolean) => { await act(async () => {
    root.render(<TooltipProvider><TeamChatPanel agentClient={client} teamInstanceId={instance.id} active={active} onOpenConversation={() => {}} /></TooltipProvider>);
    for (let i = 0; i < 15; i++) await Promise.resolve();
  }); };
  await show(false);
  const viewport = container.querySelector<HTMLElement>('[aria-label="群消息"]')!;
  let height = 1200, top = 0;
  const readHeight = vi.fn(() => height);
  Object.defineProperties(viewport, { scrollHeight: { configurable: true, get: readHeight }, clientHeight: { configurable: true, value: 600 },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.min(value, height - 600); } } });
  return { show, viewport, readHeight, mark, grow: () => { height += 140; } };
}
it("defers group geometry until the next frame and keeps following through queued automatic scroll events", async () => {
  const f = await fixture(); await f.show(true);
  expect(f.readHeight).not.toHaveBeenCalled(); expect(f.viewport.scrollTop).toBe(0);
  expect(f.mark).toHaveBeenCalledTimes(1);
  expect(f.viewport.hasAttribute("data-deferred-scroll-root")).toBe(true);
  nextFrame(); expect(f.viewport.scrollTop).toBe(600);
  f.mark.mockClear(); f.readHeight.mockClear(); f.grow();
  act(() => { f.viewport.dispatchEvent(new Event("scroll")); });
  expect(f.readHeight).not.toHaveBeenCalled(); expect(f.mark).not.toHaveBeenCalled();
  act(() => notifyResize()); expect(f.viewport.scrollTop).toBe(740);
  act(() => { f.viewport.scrollTop = 120; f.viewport.dispatchEvent(new Event("scroll")); });
  f.grow(); act(() => notifyResize()); expect(f.viewport.scrollTop).toBe(120);
});
it("cancels a pending bottom restore when the group is hidden", async () => {
  const f = await fixture(); await f.show(true); await f.show(false);
  nextFrame(); expect(f.readHeight).not.toHaveBeenCalled(); expect(f.viewport.scrollTop).toBe(0);
});
