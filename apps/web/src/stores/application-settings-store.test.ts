import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_APPLICATION_SETTINGS } from "@agent/protocol";

import { useApplicationSettingsStore } from "./application-settings-store.js";

describe("useApplicationSettingsStore", () => {
  beforeEach(() => {
    useApplicationSettingsStore.setState({
      approvalReviewer: DEFAULT_APPLICATION_SETTINGS.general.approvalReviewer,
      defaultMessageDeliveryMode:
        DEFAULT_APPLICATION_SETTINGS.general.defaultMessageDeliveryMode,
      defaultPermissionMode: DEFAULT_APPLICATION_SETTINGS.general.defaultPermissionMode,
      isHydrated: false,
      permissionPolicies: structuredClone(DEFAULT_APPLICATION_SETTINGS.permissionPolicies),
      sendShortcut: DEFAULT_APPLICATION_SETTINGS.general.sendShortcut,
      showContextUsage: DEFAULT_APPLICATION_SETTINGS.general.showContextUsage,
    });
  });

  it("uses queue initially and updates the configured delivery default", () => {
    expect(useApplicationSettingsStore.getState().defaultMessageDeliveryMode).toBe("queue");

    useApplicationSettingsStore.getState().setDefaultMessageDeliveryMode("steer");
    expect(useApplicationSettingsStore.getState().defaultMessageDeliveryMode).toBe("steer");

    useApplicationSettingsStore.getState().hydrateGeneralConfiguration({
      approvalReviewer: "auto_review",
      defaultPermissionMode: "full_access",
      defaultMessageDeliveryMode: "queue",
      sendShortcut: "ctrl_enter",
      showContextUsage: false,
    });
    expect(useApplicationSettingsStore.getState()).toMatchObject({
      approvalReviewer: "auto_review",
      defaultMessageDeliveryMode: "queue",
      defaultPermissionMode: "full_access",
      isHydrated: true,
      sendShortcut: "ctrl_enter",
      showContextUsage: false,
    });
  });
});
