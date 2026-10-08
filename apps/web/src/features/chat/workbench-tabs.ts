export const FUNCTION_TABS = {
  "page:team": "任务看板",
  "page:settings": "设置",
} as const;

export function isFunctionTab(id: string): id is keyof typeof FUNCTION_TABS {
  return id === "page:team" || id === "page:settings";
}

export type WorkbenchTabs = { ids: string[]; previewId: string | null };

/** Only the unretained conversation is replaced; function pages have their own tabs. */
export function reconcileWorkbenchTabs(
  state: WorkbenchTabs, availableIds: readonly string[], activeId: string | null,
): WorkbenchTabs {
  const available = new Set(availableIds);
  let ids = state.ids.filter((id) => isFunctionTab(id) || available.has(id));
  let previewId = state.previewId !== null && ids.includes(state.previewId) ? state.previewId : null;
  if (activeId !== null && (isFunctionTab(activeId) || available.has(activeId)) && !ids.includes(activeId)) {
    if (isFunctionTab(activeId)) ids.push(activeId);
    else {
      if (previewId !== null) ids = ids.map((id) => id === previewId ? activeId : id);
      else ids.push(activeId);
      previewId = activeId;
    }
  }
  return previewId === state.previewId && ids.length === state.ids.length
    && ids.every((id, index) => id === state.ids[index]) ? state : { ids, previewId };
}
