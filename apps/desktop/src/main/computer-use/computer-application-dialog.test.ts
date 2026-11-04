import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
const native = vi.hoisted(() => ({ dialog: vi.fn(), getFileIcon: vi.fn(() => Promise.resolve({ native: true })) }));
vi.mock("electron", () => ({ app: { getFileIcon: native.getFileIcon }, dialog: { showMessageBox: native.dialog } }));
import { requestComputerApplicationAccess } from "./computer-application-dialog.js";
const application = { id: "11111111-1111-4111-8111-111111111111", name: "Editor", executablePath: "C:\\Editor.exe", enabled: true };
const window = { isDestroyed: () => false } as BrowserWindow;
describe("Computer software permission dialog", () => {
  it.each([[0, "deny"], [1, "session"], [2, "permanent"]] as const)("maps user choice %i to %s and defaults to denial", async (response, expected) => {
    native.dialog.mockResolvedValueOnce({ response }); const signal = new AbortController().signal;
    expect(await requestComputerApplicationAccess(() => window, application, signal)).toBe(expected);
    expect(native.dialog).toHaveBeenLastCalledWith(window, expect.objectContaining({ buttons: ["拒绝", "仅本次允许", "永久允许"], cancelId: 0, defaultId: 0, signal, icon: { native: true } }));
  });
  it("does not grant a response arriving after the session has stopped", async () => {
    const abort = new AbortController(); native.dialog.mockImplementationOnce(() => { abort.abort(); return Promise.resolve({ response: 2 }); });
    await expect(requestComputerApplicationAccess(() => window, application, abort.signal)).rejects.toThrow();
    expect(await requestComputerApplicationAccess(() => null, application, new AbortController().signal)).toBe("deny");
  });
});
