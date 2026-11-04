import { describe, expect, it } from "vitest";

import { appendNewTabIds, moveTabId } from "./tab-order.js";

describe("tab order", () => {
  it("appends new kinds without moving existing or temporarily hidden tabs", () => {
    const order = ["terminal", "chat"];
    expect(appendNewTabIds(order, ["file", "terminal", "chat", "file"]))
      .toEqual(["terminal", "chat", "file"]);
    expect(appendNewTabIds(order, ["chat"])).toBe(order);
  });
  it("moves in either direction and appends a reopened tab", () => {
    const order = ["a", "b", "c"];
    expect(moveTabId(order, "a", "c", "after")).toEqual(["b", "c", "a"]);
    expect(moveTabId(order, "c", "a", "before")).toEqual(["c", "a", "b"]);
    expect(appendNewTabIds(["c", "a"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
    expect(order).toEqual(["a", "b", "c"]);
  });
  it("ignores stale and self drops", () => {
    const order = ["a", "b"];
    expect(moveTabId(order, "missing", "b", "after")).toBe(order);
    expect(moveTabId(order, "a", "missing", "before")).toBe(order);
    expect(moveTabId(order, "a", "a", "after")).toBe(order);
  });
});
