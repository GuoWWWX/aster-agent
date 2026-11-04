import { useLayoutEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { useUndoStore } from "../../stores/undo-store.js";

// Only this hook writes these in-process snapshots; never hydrate from disk.
const sessionHistories = new WeakMap<object, Map<string, { entries: unknown[]; index: number }>>();

/** Keeps reference metadata with text so undo cannot produce a dangling mention. */
export function useComposerHistory<T>(snapshot: T, restore: (snapshot: T) => void,
  ref: RefObject<HTMLTextAreaElement | null>, sessionId?: string, scope?: object) {
  const [cache] = useState(() => {
    if (scope === undefined) return undefined;
    const entries = sessionHistories.get(scope) ?? new Map<string, { entries: unknown[]; index: number }>();
    sessionHistories.set(scope, entries);
    return entries;
  });
  const [initial] = useState(() => sessionId === undefined ? undefined : cache?.get(sessionId));
  const [restored, setRestored] = useState(initial === undefined);
  const [state, setState] = useState(() => initial === undefined
    ? { entries: [snapshot], index: 0 }
    : { entries: initial.entries as T[], index: initial.index });
  if (!restored) {
    setRestored(true);
    restore(state.entries[state.index]!);
  } else if (JSON.stringify(snapshot) !== JSON.stringify(state.entries[state.index])) {
    const entries = [...state.entries.slice(0, state.index + 1), snapshot].slice(-100);
    setState({ entries, index: entries.length - 1 });
  }
  const move = (delta: number): void => {
    const input = ref.current;
    const index = state.index + delta;
    if (input === null || input.disabled || input.readOnly || index < 0 || index >= state.entries.length) return;
    setState({ ...state, index });
    restore(state.entries[index]!);
    input.focus();
  };
  const publish = (): void => {
    const element = ref.current;
    if (element === null) return;
    useUndoStore.getState().setEditor({ element,
      canUndo: state.index > 0 && !element.disabled, canRedo: state.index < state.entries.length - 1 && !element.disabled,
      undo: () => move(-1), redo: () => move(1) });
  };
  useLayoutEffect(() => {
    if (sessionId !== undefined) cache?.set(sessionId, state);
    if (document.activeElement === ref.current) publish();
  });
  useLayoutEffect(() => {
    const element = ref.current;
    return () => { if (useUndoStore.getState().editor?.element === element) useUndoStore.getState().setEditor(null); };
  }, [ref]);
  return { onFocus: publish, onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return false;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return false;
    event.preventDefault();
    event.stopPropagation();
    move(key === "y" || event.shiftKey ? 1 : -1);
    return true;
  } };
}
