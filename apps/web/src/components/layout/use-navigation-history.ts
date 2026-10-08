import { useState } from "react";

/** Session-only navigation; moving through history never appends another entry. */
export function useNavigationHistory<T>(current: T, key: (entry: T) => string,
  restore: (entry: T) => void, available: (entry: T) => boolean) {
  const [history, setHistory] = useState({ entries: [current], index: 0 });
  if (key(history.entries[history.index]!) !== key(current)) {
    const entries = [...history.entries.slice(0, history.index + 1), current].slice(-100);
    setHistory({ entries, index: entries.length - 1 });
  }
  const targetIndex = (direction: -1 | 1): number => {
    for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction) {
      if (available(history.entries[index]!)) return index;
    }
    return -1;
  };
  const go = (direction: -1 | 1): void => {
    const index = targetIndex(direction);
    if (index < 0) return;
    setHistory({ ...history, index });
    restore(history.entries[index]!);
  };
  return { canGoBack: targetIndex(-1) >= 0, canGoForward: targetIndex(1) >= 0,
    goBack: () => go(-1), goForward: () => go(1) };
}
