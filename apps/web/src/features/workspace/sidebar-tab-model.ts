import type { ConfigurationWorkspaceKind } from "@agent/protocol";
import type { ConfigurationWorkspaceTarget } from "../../stores/workbench-ui-store.js";
import type { ConfigurationFileTab, ToolTab } from "./sidebar-workspace-types.js";

type TerminalTabNameCandidate = {
  kind: ToolTab["kind"];
  name: string;
  projectId?: string;
};

type WorkspaceTabNameCandidate = {
  name: string;
};

export function nextWorkspaceTabName(
  tabs: readonly WorkspaceTabNameCandidate[],
  requestedName: string,
): string {
  const names = new Set(tabs.map((tab) => tab.name));
  if (!names.has(requestedName)) return requestedName;

  let ordinal = 1;
  let candidate = `${requestedName} (${ordinal})`;
  while (names.has(candidate)) {
    ordinal += 1;
    candidate = `${requestedName} (${ordinal})`;
  }
  return candidate;
}

export function nextTerminalTabName(
  tabs: readonly TerminalTabNameCandidate[],
  projectId: string,
): string {
  const names = new Set(
    tabs
      .filter((tab) => tab.kind === "terminal" && tab.projectId === projectId)
      .map((tab) => tab.name),
  );
  let ordinal = 1;
  while (names.has(ordinal === 1 ? "终端" : `终端 (${ordinal - 1})`)) ordinal += 1;
  return ordinal === 1 ? "终端" : `终端 (${ordinal - 1})`;
}

export function scrollWorkspaceTabsOnWheel(
  tabs: Pick<HTMLElement, "clientWidth" | "scrollLeft" | "scrollWidth">,
  event: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY" | "preventDefault">,
): void {
  const maxScrollLeft = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
  if (maxScrollLeft === 0) return;

  const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX
    : event.deltaY;
  if (rawDelta === 0) return;

  const deltaScale = event.deltaMode === 1
    ? 32
    : event.deltaMode === 2
      ? tabs.clientWidth
      : 1;
  const nextScrollLeft = Math.max(
    0,
    Math.min(maxScrollLeft, tabs.scrollLeft + rawDelta * deltaScale),
  );
  if (nextScrollLeft === tabs.scrollLeft) return;

  tabs.scrollLeft = nextScrollLeft;
  event.preventDefault();
}

export function shouldCollapseRightSidebarAfterClosingTabs(
  openTabs: ReadonlyArray<{ id: string }>,
  closedTabIds: ReadonlySet<string>,
): boolean {
  return openTabs.length > 0 && openTabs.every((tab) => closedTabIds.has(tab.id));
}

export function activeSidebarTabIdAfterClosingTabs(
  openTabs: ReadonlyArray<{ id: string }>,
  activeTabId: string | null,
  closedTabIds: ReadonlySet<string>,
): string | null {
  const remainingTabs = openTabs.filter((tab) => !closedTabIds.has(tab.id));
  if (remainingTabs.length === 0) return null;
  if (
    activeTabId !== null
    && openTabs.some((tab) => tab.id === activeTabId)
    && !closedTabIds.has(activeTabId)
  ) {
    return activeTabId;
  }

  const activeIndex = openTabs.findIndex((tab) => tab.id === activeTabId);
  if (activeIndex < 0) return remainingTabs[0]?.id ?? null;
  for (let index = activeIndex + 1; index < openTabs.length; index += 1) {
    const candidate = openTabs[index];
    if (candidate !== undefined && !closedTabIds.has(candidate.id)) return candidate.id;
  }
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    const candidate = openTabs[index];
    if (candidate !== undefined && !closedTabIds.has(candidate.id)) return candidate.id;
  }
  return remainingTabs[0]?.id ?? null;
}

export function fileTabId(projectId: string, path: string): string {
  return `file:${projectId}:${path}`;
}

export function configurationFileTabId(
  kind: ConfigurationWorkspaceKind,
  configurationId: string,
  path: string,
): string {
  return `configuration:${kind}:${configurationId}:${path}`;
}

export function agentPromptTabId(agentId: string): string {
  return `agent-prompt:${agentId}`;
}

export function isSettingsWorkspaceTabId(tabId: string | null): boolean {
  return tabId?.startsWith("agent-prompt:") === true
    || tabId?.startsWith("configuration:") === true;
}

export function targetForConfigurationTab(tab: ConfigurationFileTab): ConfigurationWorkspaceTarget {
  return {
    configurationId: tab.configurationId,
    kind: tab.configurationKind,
    title: tab.title,
  };
}
