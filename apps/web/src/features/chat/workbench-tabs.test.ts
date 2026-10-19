import { describe, expect, it } from "vitest";
import { teamChatTabId, teamChatInstanceId, reconcileWorkbenchTabs } from "./workbench-tabs.js";

describe("workbench preview tabs", () => {
  it("reuses a team chat tab independently from member conversations and the board", () => {
    const chatId = teamChatTabId("team-instance");
    const first = reconcileWorkbenchTabs({ ids: ["member", "page:team"], previewId: null }, ["member", chatId], chatId);
    expect(first.ids).toEqual(["member", "page:team", chatId]);
    expect(reconcileWorkbenchTabs(first, ["member", chatId], chatId)).toBe(first);
    expect(teamChatInstanceId(chatId)).toBe("team-instance"); expect(teamChatInstanceId("member")).toBeNull();
    expect(reconcileWorkbenchTabs(first, ["member"], "member").ids).toEqual(["member", "page:team"]);
  });
  it("keeps the scheduled task page separate from conversation previews and opens it once", () => {
    const first = reconcileWorkbenchTabs({ ids: ["a"], previewId: "a" }, ["a", "b"], "page:schedules");
    expect(first).toEqual({ ids: ["a", "page:schedules"], previewId: "a" });
    expect(reconcileWorkbenchTabs(first, ["a", "b"], "page:schedules")).toBe(first);
    expect(reconcileWorkbenchTabs(first, ["a", "b"], "b")).toEqual({ ids: ["b", "page:schedules"], previewId: "b" });
  });
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
