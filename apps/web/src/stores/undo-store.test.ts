import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUndoStore } from "./undo-store.js";
beforeEach(() => useUndoStore.setState({ past: [], future: [], busy: false, error: null, editor: null }));
describe("session undo", () => {
  it("undoes and redoes in order, clearing redo on a new action", async () => {
    const action = { label: "归档", undo: vi.fn().mockResolvedValue(undefined), redo: vi.fn().mockResolvedValue(undefined) };
    useUndoStore.getState().push(action);
    await useUndoStore.getState().undo();
    expect(action.undo).toHaveBeenCalledOnce();
    expect(useUndoStore.getState().future).toEqual([action]);
    await useUndoStore.getState().redo();
    expect(action.redo).toHaveBeenCalledOnce();
    await useUndoStore.getState().undo();
    useUndoStore.getState().push(action);
    expect(useUndoStore.getState().future).toEqual([]);
  });
  it("retains failed actions for retry and does not advance history", async () => {
    const action = { label: "删除", undo: vi.fn().mockRejectedValue(new Error("unavailable")), redo: vi.fn() };
    useUndoStore.getState().push(action);
    await useUndoStore.getState().undo();
    expect(useUndoStore.getState().past).toEqual([action]);
    expect(useUndoStore.getState().error).toContain("失败");
    expect(useUndoStore.getState().busy).toBe(false);
  });
});
