import { create } from "zustand";

export type UndoAction = { label: string; undo: () => Promise<void>; redo: () => Promise<void> };
type UndoState = {
  editor: { element: HTMLTextAreaElement; canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void } | null;
  setEditor: (editor: UndoState["editor"]) => void;
  past: UndoAction[]; future: UndoAction[]; busy: boolean; error: string | null;
  push: (action: UndoAction) => void;
  undo: () => Promise<void>; redo: () => Promise<void>; clearError: () => void;
};
export const useUndoStore = create<UndoState>((set, get) => {
  const run = async (direction: "undo" | "redo"): Promise<void> => {
    if (get().busy) return;
    const action = (direction === "undo" ? get().past : get().future).at(-1);
    if (action === undefined) return;
    set({ busy: true, error: null });
    try {
      await action[direction]();
      set((state) => direction === "undo"
        ? { past: state.past.slice(0, -1), future: [...state.future, action] }
        : { past: [...state.past, action], future: state.future.slice(0, -1) });
    } catch {
      set({ error: `${direction === "undo" ? "撤销" : "重做"}“${action.label}”失败，记录已保留，请重试。` });
    } finally { set({ busy: false }); }
  };
  return { editor: null, setEditor: (editor) => set({ editor }), past: [], future: [], busy: false, error: null,
    push: (action) => set((state) => ({ past: [...state.past, action].slice(-100), future: [], error: null })),
    undo: () => run("undo"), redo: () => run("redo"), clearError: () => set({ error: null }) };
});
