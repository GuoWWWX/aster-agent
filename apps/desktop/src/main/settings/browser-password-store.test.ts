import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserPasswordStore } from "./browser-password-store.js";

const storageMocks = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true), getSelectedStorageBackend: vi.fn(() => "unknown"),
  encryptString: vi.fn((value: string) => Buffer.from(value).map((byte) => byte ^ 123)),
  decryptString: vi.fn((value: Buffer) => value.map((byte) => byte ^ 123).toString()),
}));
vi.mock("electron", () => ({ safeStorage: storageMocks }));
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  storageMocks.isEncryptionAvailable.mockReturnValue(true);
  storageMocks.getSelectedStorageBackend.mockReturnValue("unknown");
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function createStore(): Promise<{ store: BrowserPasswordStore; file: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-browser-password-"));
  directories.push(directory);
  const file = path.join(directory, "passwords.json");
  return { file, store: new BrowserPasswordStore(file) };
}
const login = { origin: "https://example.com", username: "test-user", password: "test-password" };

describe("BrowserPasswordStore", () => {
  it("encrypts all credential data, restores it after restart and scopes lookup to the exact origin", async () => {
    const { store, file } = await createStore();
    store.save(login);
    const text = await readFile(file, "utf8");
    for (const value of Object.values(login)) expect(text).not.toContain(value);
    const reopened = new BrowserPasswordStore(file);
    expect(reopened.get(login.origin)).toEqual(login);
    expect(reopened.get("https://sub.example.com")).toBeNull();
    expect(reopened.get("http://example.com")).toBeNull();
    store.save({ ...login, password: "updated" });
    expect(reopened.get(login.origin)?.password).toBe("updated");
    store.clear();
    expect(reopened.get(login.origin)).toBeNull();
  });
  it("rejects unavailable encryption and plaintext fallback without writing a file", async () => {
    const { store, file } = await createStore();
    storageMocks.isEncryptionAvailable.mockReturnValue(false);
    expect(() => store.save(login)).toThrow("系统密码加密不可用");
    storageMocks.isEncryptionAvailable.mockReturnValue(true);
    vi.stubGlobal("process", { ...process, platform: "linux" });
    storageMocks.getSelectedStorageBackend.mockReturnValue("basic_text");
    expect(() => store.save(login)).toThrow("系统密码加密不可用");
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects insecure origins and does not replace saved data when decryption fails", async () => {
    const { store, file } = await createStore();
    expect(() => store.save({ ...login, origin: "http://example.com" })).toThrow();
    store.save(login);
    const original = await readFile(file, "utf8");
    storageMocks.decryptString.mockImplementationOnce(() => { throw new Error("decrypt failed"); });
    expect(() => store.save({ ...login, password: "updated" })).toThrow();
    expect(await readFile(file, "utf8")).toBe(original);
  });
  it("does not call the Linux-only storage backend API on Windows", async () => {
    const { store } = await createStore();
    vi.stubGlobal("process", { ...process, platform: "win32" });
    expect(store.isAvailable()).toBe(true);
    expect(storageMocks.getSelectedStorageBackend).not.toHaveBeenCalled();
  });
});
