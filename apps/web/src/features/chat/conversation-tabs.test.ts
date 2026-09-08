import { describe, expect, it } from "vitest";

import { closeConversationTab, openConversationTab, reconcileConversationTabs } from "./conversation-tabs.js";

describe("conversation tabs", () => {
  it("reconciles selection and archive changes without replacing unchanged tabs", () => {
    const current = ["first", "second"];
    expect(reconcileConversationTabs(current, ["first", "second"], "first")).toBe(current);
    expect(reconcileConversationTabs(current, ["first", "third"], "third")).toEqual(["first", "third"]);
    expect(reconcileConversationTabs(current, ["second"], "first")).toEqual(["second"]);
    expect(reconcileConversationTabs([], [], "first")).toEqual([]);
    expect(reconcileConversationTabs([], ["first"], "first")).toEqual(["first"]);
  });

  it("opens each conversation once while preserving tab order", () => {
    expect(openConversationTab(["first"], "second")).toEqual(["first", "second"]);
    expect(openConversationTab(["first", "second"], "first")).toEqual(["first", "second"]);
  });

  it("activates the adjacent tab when the active tab closes", () => {
    expect(closeConversationTab(["first", "second", "third"], "second", "second")).toEqual({
      nextActiveId: "third",
      openIds: ["first", "third"],
    });
    expect(closeConversationTab(["first", "third"], "third", "third")).toEqual({
      nextActiveId: "first",
      openIds: ["first"],
    });
  });

  it("keeps the active conversation when another tab closes", () => {
    expect(closeConversationTab(["first", "second"], "first", "second")).toEqual({
      nextActiveId: "second",
      openIds: ["second"],
    });
  });

  it("clears the active conversation when the last tab closes", () => {
    expect(closeConversationTab(["only"], "only", "only")).toEqual({
      nextActiveId: null,
      openIds: [],
    });
  });
});
