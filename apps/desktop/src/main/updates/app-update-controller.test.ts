import { CancellationToken } from "builder-util-runtime";
import type { UpdateCheckResult } from "electron-updater";
import { describe, expect, it, vi } from "vitest";
import { AppUpdateController } from "./app-update-controller.js";

function available(version: string): UpdateCheckResult {
  const info = { version, files: [{ url: `Aster-${version}-x64-setup.exe`, sha512: "unused" }],
    path: `Aster-${version}-x64-setup.exe`, sha512: "unused", releaseDate: "2026-01-01" };
  return { isUpdateAvailable: true, updateInfo: info, versionInfo: info };
}

describe("AppUpdateController", () => {
  it("checks, downloads and installs only after the user requests installation", async () => {
    const engine = { checkForUpdates: vi.fn().mockResolvedValue(available("0.2.0")),
      downloadUpdate: vi.fn().mockResolvedValue(["installer.exe"]), quitAndInstall: vi.fn() };
    const controller = new AppUpdateController(engine, "unused", "0.1.0", true);
    expect((await controller.check()).status).toBe("available");
    expect(controller.download().status).toBe("downloading");
    await vi.waitFor(() => expect(controller.getState().status).toBe("downloaded"));
    expect(engine.quitAndInstall).not.toHaveBeenCalled();
    controller.install();
    expect(engine.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
  });

  it("pauses an active transfer and allows checking for a newer release", async () => {
    const engine = { checkForUpdates: vi.fn().mockResolvedValueOnce(available("0.2.0")).mockResolvedValueOnce(available("0.3.0")),
      downloadUpdate: vi.fn((token: CancellationToken) => new Promise<string[]>((_resolve, reject) => token.once("cancel", () => reject(new Error("cancelled"))))),
      quitAndInstall: vi.fn() };
    const controller = new AppUpdateController(engine, "unused", "0.1.0", true);
    await controller.check();
    controller.download();
    await vi.waitFor(() => expect(engine.downloadUpdate).toHaveBeenCalledOnce());
    controller.reportProgress({ mode: "differential", transferred: 25, total: 100, bytesPerSecond: 10 });
    expect(controller.getState().progress?.transferred).toBe(25);
    expect(await controller.check()).toMatchObject({ status: "available", availableVersion: "0.3.0", progress: null });
    expect(engine.downloadUpdate.mock.calls[0]?.[0].cancelled).toBe(true);
  });

  it("does not contact the update service in unsupported or development environments", async () => {
    const engine = { checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() };
    const controller = new AppUpdateController(engine, "unused", "0.1.0", false);
    controller.start();
    expect((await controller.check()).status).toBe("unavailable");
    expect(controller.download().status).toBe("unavailable");
    expect(engine.checkForUpdates).not.toHaveBeenCalled();
    expect(engine.downloadUpdate).not.toHaveBeenCalled();
  });
});
