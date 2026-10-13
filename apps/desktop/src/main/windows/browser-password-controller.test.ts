import { EventEmitter } from "node:events";
import { type BrowserWindow, type WebContents } from "electron";
import { BROWSER_PASSWORD_CHANNELS } from "@agent/protocol";
import { describe, expect, it, vi } from "vitest";
import { installBrowserPasswords } from "./browser-password-controller.js";
import type { BrowserPasswordStore } from "../settings/browser-password-store.js";
const passwordDialog = vi.hoisted(() => vi.fn(() => Promise.resolve({ response: 0, checkboxChecked: false })));
vi.mock("electron", () => ({ dialog: { showMessageBox: passwordDialog } }));
const login = { origin: "https://example.com", username: "test", password: "test-secret" };
function setup() {
  const frame = { url: "https://example.com/login" };
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: frame, getURL: vi.fn(() => frame.url), isDestroyed: () => false, send: vi.fn(),
  });
  const store = { get: vi.fn(() => null), save: vi.fn(), clear: vi.fn(), isAvailable: () => true };
  let enabled = true;
  const error = vi.fn();
  const controller = installBrowserPasswords(contents as unknown as WebContents, {} as BrowserWindow,
    store as unknown as BrowserPasswordStore, () => enabled, error);
  return { contents, frame, store, controller, error, disable: () => { enabled = false; controller.refresh(); } };
}
async function settle(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }
describe("browser password lifecycle", () => {
  it("saves only a validated top-frame submission after confirmation and disposes listeners", async () => {
    const { contents, frame, store, controller } = setup();
    contents.emit("ipc-message", { senderFrame: { url: frame.url } }, BROWSER_PASSWORD_CHANNELS.submit, login);
    contents.emit("ipc-message", { senderFrame: frame }, BROWSER_PASSWORD_CHANNELS.submit, { ...login, origin: "https://other.com" });
    contents.emit("ipc-message", { senderFrame: frame }, BROWSER_PASSWORD_CHANNELS.submit, { password: "bad" });
    await settle();
    expect(store.save).not.toHaveBeenCalled();
    contents.emit("ipc-message", { senderFrame: frame }, BROWSER_PASSWORD_CHANNELS.submit, login);
    await settle();
    expect(store.save).toHaveBeenCalledExactlyOnceWith(login);
    controller.dispose();
    expect(contents.listenerCount("dom-ready")).toBe(0);
    expect(contents.listenerCount("ipc-message")).toBe(0);
  });
  it("withholds credentials on insecure pages and stops saving immediately when disabled", async () => {
    const { contents, frame, store, controller, disable } = setup();
    frame.url = "http://example.com/login";
    controller.refresh();
    expect(contents.send).toHaveBeenLastCalledWith(BROWSER_PASSWORD_CHANNELS.configure, { enabled: false, credential: null });
    frame.url = "https://example.com/login";
    disable();
    contents.emit("ipc-message", { senderFrame: frame }, BROWSER_PASSWORD_CHANNELS.submit, login);
    await settle();
    expect(store.save).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("does not save declined prompts or prompts pending when the tab closes", async () => {
    const { contents, frame, store, controller } = setup();
    passwordDialog.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
    contents.emit("ipc-message", { senderFrame: frame }, BROWSER_PASSWORD_CHANNELS.submit, login);
    await settle();
    expect(store.save).not.toHaveBeenCalled();
    contents.emit("ipc-message", { senderFrame: frame }, BROWSER_PASSWORD_CHANNELS.submit, login);
    controller.dispose();
    await settle();
    expect(store.save).not.toHaveBeenCalled();
  });
});
