import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const security = vi.hoisted(() => ({ available: true, fail: false }));
vi.mock("electron", () => ({ safeStorage: {
  isEncryptionAvailable: () => security.available,
  getSelectedStorageBackend: () => "system",
  encryptString: (text: string) => Buffer.from(text),
  decryptString: (bytes: Buffer) => { if (security.fail) throw new Error("ciphertext"); return bytes.toString(); },
} }));
import { ChatGptPlanStore } from "./chatgpt-plan-store.js";
const directories: string[] = [];
afterEach(async () => { security.available = true; security.fail = false; await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-auth-store-")); directories.push(directory);
  const file = path.join(directory, "auth.json"); return { directory, file, store: new ChatGptPlanStore(file) };
}
describe("authorization storage recovery", () => {
  it("preserves inaccessible ciphertext until a new sign-in explicitly starts", async () => {
    const { store, file, directory } = await fixture(); store.hostId();
    const before = await readFile(file, "utf8"); security.fail = true;
    expect(() => store.list()).toThrow("登录信息已失效，请重新登录。");
    expect(await readFile(file, "utf8")).toBe(before);
    store.prepareSignIn(); security.fail = false;
    expect(store.list()).toEqual([]);
    const backup = (await readdir(directory)).find((name) => name.includes(".unreadable-"));
    expect(backup).toBeDefined(); expect(await readFile(path.join(directory, backup!), "utf8")).toBe(before);
  });
  it("retains the host identity on routine sign-in and restart", async () => {
    const { store, file } = await fixture(); const host = store.hostId(); store.prepareSignIn();
    expect(new ChatGptPlanStore(file).hostId()).toBe(host);
  });
  it("does not overwrite malformed configuration or use insecure storage", async () => {
    const { store, file } = await fixture(); await writeFile(file, "broken");
    expect(() => store.prepareSignIn()).toThrow(); expect(await readFile(file, "utf8")).toBe("broken");
    security.available = false; expect(() => store.prepareSignIn()).toThrow("系统安全存储不可用");
  });
});
