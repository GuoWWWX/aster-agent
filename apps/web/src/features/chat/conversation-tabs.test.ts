import { describe, expect, it } from "vitest";

import { closeConversationTab, openConversationTab } from "./conversation-tabs.js";

describe("conversation tabs", () => {
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
