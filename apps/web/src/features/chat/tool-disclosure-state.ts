import { createContext, useCallback, useContext, useState, type SetStateAction } from "react";

// Owned by the mounted conversation, not global state or persisted business history.
export const ToolDisclosureContext = createContext< Map<string, boolean> | null>(null);

export function useToolDisclosure(id: string, childIds: string[] = [], defaultExpanded = false) {
  const choices = useContext(ToolDisclosureContext);
  const [expanded, setExpanded] = useState(() => choices?.get(id)
    ?? (childIds.some((childId) => choices?.get(childId) === true) || defaultExpanded));
  const setChoice = useCallback((action: SetStateAction<boolean>): void => {
    setExpanded((current) => {
      const value = typeof action === "function" ? action(current) : action;
      choices?.set(id, value);
      return value;
    });
  }, [choices, id]);
  return [expanded, setChoice] as const;
}
