import { createContext, useContext, useState, type SetStateAction } from "react";

// Owned by the mounted conversation, not global state or persisted business history.
export const ToolDisclosureContext = createContext< Map<string, boolean> | null>(null);

export function useToolDisclosure(id: string, childIds: string[] = []) {
  const choices = useContext(ToolDisclosureContext);
  const [expanded, setExpanded] = useState(() => choices?.get(id)
    ?? childIds.some((childId) => choices?.get(childId) === true));
  const setChoice = (action: SetStateAction<boolean>): void => {
    const value = typeof action === "function" ? action(expanded) : action;
    choices?.set(id, value);
    setExpanded(value);
  };
  return [expanded, setChoice] as const;
}
