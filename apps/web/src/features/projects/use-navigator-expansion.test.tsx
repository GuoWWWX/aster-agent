// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createProjectSession } from "./project-session-model.js";
import { useNavigatorExpansion } from "./use-navigator-expansion.js";

let root: Root | null = null;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  frames.clear(); frameId = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
    frames.set(++frameId, callback); return frameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
});

afterEach(() => {
  act(() => root?.unmount()); root = null;
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function runNextFrame(): void {
  const next = frames.entries().next().value;
  if (next === undefined) throw new Error("No pending animation frame");
  frames.delete(next[0]);
  act(() => next[1](0));
}

async function fixture() {
  const target = { ...createProjectSession("project-a", [], "target"), parentConversationId: "parent" };
  const sessions = [target];
  const locateRequest = { id: target.id, kind: "session" as const, requestId: 1 };
  let expansion!: ReturnType<typeof useNavigatorExpansion>;
  const scroll = vi.fn();
  function Harness() {
    expansion = useNavigatorExpansion({ activeProjectId: null,
      locateRequest, sessions });
    return <div ref={expansion.bodyRef}><button data-navigator-key="session:target"
      ref={element => { if (element !== null) element.scrollIntoView = scroll; }} /></div>;
  }
  const container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => { root?.render(<Harness />); await Promise.resolve(); });
  return { current: () => expansion, scroll };
}

it("reveals the located conversation's project and parent before scrolling the row", async () => {
  const f = await fixture();
  expect(f.current().isProjectExpanded("project-a")).toBe(true);
  expect(f.current().expandedSessionIds.has("parent")).toBe(true);
  expect(f.scroll).not.toHaveBeenCalled();
  runNextFrame();
  expect(f.scroll).not.toHaveBeenCalled();
  runNextFrame();
  expect(f.scroll).toHaveBeenCalledExactlyOnceWith({ behavior: "smooth", block: "center" });
});

it("cancels the pending locate animation frame when the navigator unmounts", async () => {
  const f = await fixture();
  runNextFrame();
  expect(frames.size).toBe(1);
  act(() => { root?.unmount(); root = null; });
  expect(frames.size).toBe(0);
  expect(f.scroll).not.toHaveBeenCalled();
});
