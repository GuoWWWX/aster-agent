import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS, DEFAULT_MODEL_CATALOG } from "@agent/protocol";

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcRenderer: electronMocks,
}));

import { createDesktopBridge } from "./api.js";

describe("Desktop preload bridge", () => {
  it("sends model catalog updates through their dedicated IPC channel", async () => {
    await createDesktopBridge().saveModelCatalog(DEFAULT_MODEL_CATALOG);
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.modelSaveCatalog, DEFAULT_MODEL_CATALOG);
  });
  it("keeps browser path, password listing and explicit reveal requests separate", async () => {
    const bridge = createDesktopBridge();
    await bridge.getBrowserDefaultDownloadDirectory();
    await bridge.getBrowserSavedPasswords();
    const input = { origin: "https://example.test" };
    await bridge.revealBrowserPassword(input);
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.browserGetDefaultDownloadDirectory);
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.browserGetSavedPasswords);
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.browserRevealPassword, input);
  });
  it("requests the browser download directory through its dedicated channel", async () => {
    await createDesktopBridge().chooseBrowserDownloadDirectory();
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.browserChooseDownloadDirectory);
  });
  it("routes reversible conversation deletion and restoration through separate IPC channels", async () => {
    const input = { conversationId: "00000000-0000-4000-8000-000000000001" };
    const bridge = createDesktopBridge();
    await bridge.deleteConversationUndoable(input);
    await bridge.restoreDeletedConversation(input);
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.conversationDeleteUndoable, input);
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.conversationRestoreDeleted, input);
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends managed browser bounds without waiting for an invoke round trip", async () => {
    const bridge = createDesktopBridge();
    const input = {
      height: 600,
      sessionId: "00000000-0000-4000-8000-000000000001",
      visible: true,
      width: 900,
      x: 400,
      y: 80,
    };

    await bridge.setManagedBrowserBounds(input);

    expect(electronMocks.send).toHaveBeenCalledWith(
      IPC_CHANNELS.managedBrowserSetBounds,
      input,
    );
    expect(electronMocks.invoke).not.toHaveBeenCalled();
  });
  it("opens project directories through the project-id-only IPC", async () => {
    const input = { projectId: "00000000-0000-4000-8000-000000000001" };
    await createDesktopBridge().openProjectDirectory(input);
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.projectOpenDirectory, input);
  });
});
