import {
  DEFAULT_APPLICATION_SETTINGS,
  type ApplicationGeneralConfiguration,
  type ApplicationPermissionPolicies,
  type ConversationMessageDeliveryMode,
  type ConversationPermissionMode,
  type ConversationSendShortcut,
  type PermissionPolicy,
} from "@agent/protocol";
import { create } from "zustand";

type ApplicationSettingsState = {
  defaultMessageDeliveryMode: ConversationMessageDeliveryMode;
  defaultPermissionMode: ConversationPermissionMode;
  isHydrated: boolean;
  permissionPolicies: ApplicationPermissionPolicies;
  sendShortcut: ConversationSendShortcut;
  showContextUsage: boolean;
  hydrateGeneralConfiguration: (configuration: ApplicationGeneralConfiguration) => void;
  hydratePermissionPolicies: (permissionPolicies: ApplicationPermissionPolicies) => void;
  setDefaultMessageDeliveryMode: (mode: ConversationMessageDeliveryMode) => void;
  setDefaultPermissionMode: (mode: ConversationPermissionMode) => void;
  setSendShortcut: (shortcut: ConversationSendShortcut) => void;
  setShowContextUsage: (showContextUsage: boolean) => void;
  setPermissionPolicy: (
    permissionId: keyof ApplicationPermissionPolicies,
    policy: PermissionPolicy,
  ) => void;
};

export const useApplicationSettingsStore = create<ApplicationSettingsState>()((set) => ({
  defaultMessageDeliveryMode:
    DEFAULT_APPLICATION_SETTINGS.general.defaultMessageDeliveryMode,
  defaultPermissionMode: DEFAULT_APPLICATION_SETTINGS.general.defaultPermissionMode,
  isHydrated: false,
  permissionPolicies: structuredClone(DEFAULT_APPLICATION_SETTINGS.permissionPolicies),
  sendShortcut: DEFAULT_APPLICATION_SETTINGS.general.sendShortcut,
  showContextUsage: DEFAULT_APPLICATION_SETTINGS.general.showContextUsage,
  hydrateGeneralConfiguration: (configuration) => set({
    defaultMessageDeliveryMode: configuration.defaultMessageDeliveryMode,
    defaultPermissionMode: configuration.defaultPermissionMode,
    isHydrated: true,
    sendShortcut: configuration.sendShortcut,
    showContextUsage: configuration.showContextUsage,
  }),
  hydratePermissionPolicies: (permissionPolicies) => set({
    isHydrated: true,
    permissionPolicies: structuredClone(permissionPolicies),
  }),
  setDefaultMessageDeliveryMode: (defaultMessageDeliveryMode) => set({
    defaultMessageDeliveryMode,
  }),
  setDefaultPermissionMode: (defaultPermissionMode) => set({ defaultPermissionMode }),
  setSendShortcut: (sendShortcut) => set({ sendShortcut }),
  setShowContextUsage: (showContextUsage) => set({ showContextUsage }),
  setPermissionPolicy: (permissionId, policy) => set((state) => ({
    permissionPolicies: {
      ...state.permissionPolicies,
      [permissionId]: policy,
    },
  })),
}));
