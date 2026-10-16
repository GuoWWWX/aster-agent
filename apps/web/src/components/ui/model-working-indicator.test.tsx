// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelWorkingIndicator } from "./model-working-indicator.js";
import { modelWorkingPose, type ModelWorkPhase } from "./model-working-motion.js";

let root: Root;
let node: HTMLDivElement;
let media: EventTarget & { matches: boolean };
let callbacks: Map<number, FrameRequestCallback>;
let frameId: number;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  callbacks = new Map(); frameId = 0;
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => media);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { callbacks.set(++frameId, callback); return frameId; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { callbacks.delete(id); }));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function advance(time: number) {
  const next = callbacks.entries().next().value!;
  callbacks.delete(next[0]); next[1](time);
}

describe("model working particles", () => {
  it("uses exactly three particles and one frame clock across indicators", () => {
    act(() => root.render(<><ModelWorkingIndicator /><ModelWorkingIndicator aria-label="正在工作" /></>));
    expect(node.querySelectorAll("[data-model-working] > span")).toHaveLength(6);
    expect(callbacks.size).toBe(1);
    advance(1000);
    expect(callbacks.size).toBe(1);
    expect(node.querySelector('[aria-label="正在工作"]')?.getAttribute("role")).toBe("status");
    act(() => root.unmount());
    expect(callbacks.size).toBe(0);
  });

  it("preserves particle elements while changing phases, and stops on completion", () => {
    act(() => root.render(<ModelWorkingIndicator />));
    const dot = node.querySelector("[data-model-working] > span");
    advance(1000);
    act(() => root.render(<ModelWorkingIndicator phase="searching" />));
    expect(node.querySelector("[data-model-working] > span")).toBe(dot);
    expect(node.querySelector("[data-model-working]")?.getAttribute("data-phase")).toBe("searching");
    act(() => root.render(<ModelWorkingIndicator phase="done" />));
    advance(1100);
    expect(callbacks.size).toBe(0);
  });

  it("stops frames for reduced motion and a hidden document, then resumes", () => {
    act(() => root.render(<ModelWorkingIndicator />));
    media.matches = true; media.dispatchEvent(new Event("change"));
    expect(callbacks.size).toBe(0);
    expect([...node.querySelectorAll<HTMLElement>("[data-model-working] > span")].every(dot => dot.style.transform.includes("0.00px, 0)"))).toBe(true);
    media.matches = false; media.dispatchEvent(new Event("change"));
    expect(callbacks.size).toBe(1);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callbacks.size).toBe(0);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callbacks.size).toBe(1);
  });

  it("keeps every choreography bounded and changes thinking combinations continuously", () => {
    const phases: ModelWorkPhase[] = ["thinking", "searching", "executing", "writing", "waiting", "done"];
    for (const phase of phases) for (let step = 0; step < 220; step++) for (let index = 0; index < 3; index++) {
      const pose = modelWorkingPose(phase, step / 10, index);
      expect(Math.abs(pose.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(pose.y)).toBeLessThanOrEqual(1);
      expect(pose.opacity).toBeGreaterThanOrEqual(0);
      expect(pose.opacity).toBeLessThanOrEqual(1);
    }
    for (const time of [4.8, 9.6, 14.4, 19.2]) {
      const a = modelWorkingPose("thinking", time - .0001, 0), b = modelWorkingPose("thinking", time + .0001, 0);
      expect(Math.abs(a.x - b.x)).toBeLessThan(.01);
      expect(Math.abs(a.y - b.y)).toBeLessThan(.01);
    }
  });
});
