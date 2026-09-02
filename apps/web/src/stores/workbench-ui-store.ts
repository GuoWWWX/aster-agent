import { create } from "zustand";
import {
  DEFAULT_TERMINAL_CONFIGURATION,
  type ApplicationAppearanceConfiguration,
  type ConfigurationWorkspaceKind,
  type TerminalConfiguration,
} from "@agent/protocol";

export type ActivityView = "conversations" | "team" | "tasks" | "settings";

export type SettingsSection =
  | "general"
  | "models"
  | "agents"
  | "mcp"
  | "skills"
  | "permissions"
  | "browser"
  | "terminal"
  | "archived"
  | "appearance";

export type ThemeMode = "light" | "dark";

export type ConfigurationWorkspaceTarget = {
  configurationId: string;
  kind: ConfigurationWorkspaceKind;
  title: string;
};

export type AgentPromptWorkspaceTarget = {
  agentId: string;
  title: string;
};

export type ActiveSettingsWorkspaceTarget =
  | { kind: "agent-prompt"; target: AgentPromptWorkspaceTarget }
  | { kind: "configuration"; target: ConfigurationWorkspaceTarget };

export function resolveActiveSettingsWorkspaceTarget(
  activeActivity: ActivityView,
  settingsSection: SettingsSection,
  agentPromptWorkspaceTarget: AgentPromptWorkspaceTarget | null,
  configurationWorkspaceTarget: ConfigurationWorkspaceTarget | null,
): ActiveSettingsWorkspaceTarget | null {
  if (activeActivity !== "settings") return null;
  if (settingsSection === "agents" && agentPromptWorkspaceTarget !== null) {
    return { kind: "agent-prompt", target: agentPromptWorkspaceTarget };
  }
  if (
    configurationWorkspaceTarget !== null
    && (
      (settingsSection === "mcp" && configurationWorkspaceTarget.kind === "mcp")
      || (settingsSection === "skills" && configurationWorkspaceTarget.kind === "skill")
    )
  ) {
    return { kind: "configuration", target: configurationWorkspaceTarget };
  }
  return null;
}

export const PROJECT_NAVIGATOR_WIDTH_RANGE = {
  min: 220,
  max: 420,
} as const;

export const FILE_PANEL_WIDTH_RANGE = {
  min: 320,
  max: 960,
} as const;

export function clampWorkbenchPanelWidth(
  width: number,
  range: { min: number; max: number },
): number {
  return Math.min(range.max, Math.max(range.min, Math.round(width)));
}

type WorkbenchUiState = {
  activeActivity: ActivityView;
  agentPromptWorkspaceTarget: AgentPromptWorkspaceTarget | null;
  configurationWorkspaceRevision: number;
  configurationWorkspaceTarget: ConfigurationWorkspaceTarget | null;
  filePanelWidth: number;
  filePanelWidthsByConversationId: Record<string, number>;
  isFilePanelOpen: boolean;
  isProjectNavigatorOpen: boolean;
  isSettingsFilePanelOpen: boolean;
  closeAgentPromptWorkspace: (agentId?: string) => void;
  closeConfigurationWorkspace: (target?: Pick<ConfigurationWorkspaceTarget, "configurationId" | "kind">) => void;
  notifyConfigurationWorkspaceChanged: () => void;
  openAgentPromptWorkspace: (target: AgentPromptWorkspaceTarget) => void;
  openConfigurationWorkspace: (target: ConfigurationWorkspaceTarget) => void;
  projectNavigatorWidth: number;
  settingsSection: SettingsSection;
  setFilePanelOpen: (isOpen: boolean) => void;
  setFilePanelWidth: (width: number) => void;
  setFilePanelWidthForConversation: (conversationId: string, width: number) => void;
  setActiveActivity: (activity: ActivityView) => void;
  hydrateAppearance: (appearance: ApplicationAppearanceConfiguration) => void;
  setProjectNavigatorOpen: (isOpen: boolean) => void;
  setProjectNavigatorWidth: (width: number) => void;
  setSettingsFilePanelOpen: (isOpen: boolean) => void;
  setSettings: () => void;
  setSettingsSection: (settingsSection: SettingsSection) => void;
  setTerminalConfiguration: (terminalConfiguration: TerminalConfiguration) => void;
  setThemeMode: (themeMode: ThemeMode) => void;
  terminalConfiguration: TerminalConfiguration;
  themeMode: ThemeMode;
  toggleFilePanel: () => void;
  toggleProjectNavigator: () => void;
  toggleSettingsFilePanel: () => void;
  toggleThemeMode: () => void;
};

/**
 * This store is deliberately limited to disposable interface state. Sessions,
 * tasks, and agent execution will be queried from AgentClient when available.
 */
export const useWorkbenchUiStore = create<WorkbenchUiState>()((set) => ({
  activeActivity: "conversations",
  agentPromptWorkspaceTarget: null,
  configurationWorkspaceRevision: 0,
  configurationWorkspaceTarget: null,
  filePanelWidth: 520,
  filePanelWidthsByConversationId: {},
  isFilePanelOpen: true,
  isProjectNavigatorOpen: true,
  isSettingsFilePanelOpen: false,
  closeAgentPromptWorkspace: (agentId) => set((state) => (
    state.agentPromptWorkspaceTarget !== null
    && (agentId === undefined || state.agentPromptWorkspaceTarget.agentId === agentId)
      ? { agentPromptWorkspaceTarget: null }
      : state
  )),
  closeConfigurationWorkspace: (target) => set((state) => (
    state.configurationWorkspaceTarget !== null
    && (
      target === undefined
      || (
        state.configurationWorkspaceTarget.configurationId === target.configurationId
        && state.configurationWorkspaceTarget.kind === target.kind
      )
    )
      ? { configurationWorkspaceTarget: null }
      : state
  )),
  notifyConfigurationWorkspaceChanged: () => set((state) => ({
    configurationWorkspaceRevision: state.configurationWorkspaceRevision + 1,
  })),
  openAgentPromptWorkspace: (agentPromptWorkspaceTarget) => set({
    agentPromptWorkspaceTarget,
    configurationWorkspaceTarget: null,
    isSettingsFilePanelOpen: true,
  }),
  openConfigurationWorkspace: (configurationWorkspaceTarget) => set({
    agentPromptWorkspaceTarget: null,
    configurationWorkspaceTarget,
    isSettingsFilePanelOpen: true,
  }),
  projectNavigatorWidth: 288,
  settingsSection: "general",
  setFilePanelOpen: (isFilePanelOpen) => set({ isFilePanelOpen }),
  setFilePanelWidth: (filePanelWidth) =>
    set({
      filePanelWidth: clampWorkbenchPanelWidth(
        filePanelWidth,
        FILE_PANEL_WIDTH_RANGE,
      ),
    }),
  setFilePanelWidthForConversation: (conversationId, width) =>
    set((state) => ({
      filePanelWidthsByConversationId: {
        ...state.filePanelWidthsByConversationId,
        [conversationId]: clampWorkbenchPanelWidth(
          width,
          FILE_PANEL_WIDTH_RANGE,
        ),
      },
    })),
  setActiveActivity: (activeActivity) => set({ activeActivity }),
  hydrateAppearance: (appearance) => set({
    filePanelWidth: clampWorkbenchPanelWidth(
      appearance.filePanelWidth,
      FILE_PANEL_WIDTH_RANGE,
    ),
    isFilePanelOpen: appearance.filePanelOpen,
    isProjectNavigatorOpen: appearance.projectNavigatorOpen,
    projectNavigatorWidth: clampWorkbenchPanelWidth(
      appearance.projectNavigatorWidth,
      PROJECT_NAVIGATOR_WIDTH_RANGE,
    ),
    themeMode: appearance.themeMode,
  }),
  setProjectNavigatorOpen: (isProjectNavigatorOpen) =>
    set({ isProjectNavigatorOpen }),
  setProjectNavigatorWidth: (projectNavigatorWidth) =>
    set({
      projectNavigatorWidth: clampWorkbenchPanelWidth(
        projectNavigatorWidth,
        PROJECT_NAVIGATOR_WIDTH_RANGE,
      ),
    }),
  setSettingsFilePanelOpen: (isSettingsFilePanelOpen) => set({ isSettingsFilePanelOpen }),
  setSettings: () => set({ activeActivity: "settings" }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  setTerminalConfiguration: (terminalConfiguration) => set({ terminalConfiguration }),
  setThemeMode: (themeMode) => set({ themeMode }),
  terminalConfiguration: structuredClone(DEFAULT_TERMINAL_CONFIGURATION),
  themeMode: "light",
  toggleFilePanel: () =>
    set((state) => ({ isFilePanelOpen: !state.isFilePanelOpen })),
  toggleProjectNavigator: () =>
    set((state) => ({ isProjectNavigatorOpen: !state.isProjectNavigatorOpen })),
  toggleSettingsFilePanel: () =>
    set((state) => ({ isSettingsFilePanelOpen: !state.isSettingsFilePanelOpen })),
  toggleThemeMode: () =>
    set((state) => ({ themeMode: state.themeMode === "light" ? "dark" : "light" })),
}));
