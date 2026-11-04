// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MockAgentClient } from "../../runtime/index.js";
import { TooltipProvider } from "../ui/tooltip.js";
import { AppTitlebar } from "./app-titlebar.js";

let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("reveals the active tab after layout without forcing a synchronous page measurement", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  class Observer implements ResizeObserver {
    static instances: Observer[] = [];
    public observe = vi.fn(); public unobserve = vi.fn(); public disconnect = vi.fn();
    public constructor(public readonly callback: ResizeObserverCallback) { Observer.instances.push(this); }
  }
  vi.stubGlobal("ResizeObserver", Observer);
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const client = new MockAgentClient();
  const show = async (id: string) => { await act(async () => {
    root?.render(<TooltipProvider><AppTitlebar agentClient={client} activeConversationId={id}
      conversationTabs={[{ id: "first", title: "First", isRunning: false }, { id: "second", title: "Second", isRunning: false }]}
      conversationTabsLeadingWidth={0} contextText="" isFilePanelOpen={false} isProjectNavigatorOpen={false}
      onToggleFilePanel={() => undefined} onToggleProjectNavigator={() => undefined} /></TooltipProvider>);
    await Promise.resolve();
  }); };
  await show("first");
  const list = container.querySelector<HTMLElement>(".app-titlebar__conversation-tabs")!;
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return new DOMRect(this === list ? 0 : 150, 0, 100, 40);
  });
  await show("second");
  expect(measure).not.toHaveBeenCalled();
  const observer = Observer.instances.findLast(item => item.observe.mock.calls.some(([target]) => target === list))!;
  act(() => observer.callback([], observer));
  expect(list.scrollLeft).toBe(150);
  expect(measure).toHaveBeenCalledTimes(2);
});
