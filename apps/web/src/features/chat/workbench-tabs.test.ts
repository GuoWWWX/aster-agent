import { describe, expect, it } from "vitest";
import { reconcileWorkbenchTabs } from "./workbench-tabs.js";

describe("workbench preview tabs", () => {
  it("does not duplicate or turn a retained conversation back into a preview on repeated visits", () => {
    const state = { ids: ["a", "b"], previewId: "b" };
    expect(reconcileWorkbenchTabs(state, ["a", "b"], "a")).toBe(state);
    expect(reconcileWorkbenchTabs(state, ["a", "b"], "a")).toBe(state);
  });
  it("replaces only the preview in place and retains function tabs", () => {
    expect(reconcileWorkbenchTabs({ ids: ["a", "page:settings", "p"], previewId: "a" }, ["a", "b", "p"], "b"))
      .toEqual({ ids: ["b", "page:settings", "p"], previewId: "b" });
  });
  it("opens another preview after keeping the old conversation", () => {
    expect(reconcileWorkbenchTabs({ ids: ["a"], previewId: null }, ["a", "b"], "b"))
      .toEqual({ ids: ["a", "b"], previewId: "b" });
  });
  it("reuses existing tabs and removes unavailable conversations", () => {
    const state = { ids: ["a", "page:team"], previewId: "a" };
    expect(reconcileWorkbenchTabs(state, ["a"], "page:team")).toBe(state);
    expect(reconcileWorkbenchTabs(state, [], null)).toEqual({ ids: ["page:team"], previewId: null });
  });
});
