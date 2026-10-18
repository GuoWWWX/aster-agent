import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_COMPUTER_USE_CONFIGURATION, type ComputerUseConfiguration } from "@agent/protocol";
import { ComputerApplicationPermissions, type ComputerAccessDecision } from "./computer-application-permissions.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(decision: ComputerAccessDecision = "session") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-computer-permissions-")); roots.push(directory);
  const executablePath = path.join(directory, "editor.exe"); await writeFile(executablePath, "fixture");
  let configuration: ComputerUseConfiguration = { ...structuredClone(DEFAULT_COMPUTER_USE_CONFIGURATION), enabled: true };
  const save = vi.fn((input: ComputerUseConfiguration) => { configuration = input; return input; });
  const prompt = vi.fn(() => Promise.resolve(decision));
  const permissions = new ComputerApplicationPermissions({ getConfiguration: () => configuration, saveConfiguration: save }, prompt);
  const application = permissions.describe(executablePath);
  return { permissions, application, prompt, save, get: () => configuration, set: (value: Partial<ComputerUseConfiguration>) => { configuration = { ...configuration, ...value }; } };
}
describe.runIf(process.platform === "win32")("Computer application permissions", () => {
  it("allows an explicit session grant without persisting it, and asks again after stop", async () => {
    const f = await fixture(); const signal = new AbortController().signal;
    expect(await f.permissions.authorize(f.application, signal)).toBe(true);
    expect(await f.permissions.authorize(f.application, signal)).toBe(true);
    expect(f.prompt).toHaveBeenCalledOnce(); expect(f.save).not.toHaveBeenCalled();
    f.permissions.clearSession(); expect(await f.permissions.authorize(f.application, signal)).toBe(true);
    expect(f.prompt).toHaveBeenCalledTimes(2);
  });
  it("persists permanent grants and revives a previously disabled grant without duplicate paths", async () => {
    const f = await fixture("permanent"); f.set({ applications: [{ ...f.application, enabled: false }] });
    const application = f.permissions.describe(f.application.executablePath);
    expect(await f.permissions.authorize(application, new AbortController().signal)).toBe(true);
    expect(f.get().applications).toEqual([{ ...f.application, enabled: true }]);
    f.permissions.clearSession(); expect(f.permissions.state(application)).toBe("allowed"); expect(f.save).toHaveBeenCalledOnce();
  });
  it("applies the blacklist before all-software, permanent and temporary access", async () => {
    const f = await fixture(); await f.permissions.authorize(f.application, new AbortController().signal);
    f.set({ accessMode: "all", applications: [f.application], blockedApplications: [{ ...f.application, executablePath: f.application.executablePath.toUpperCase() }] });
    expect(await f.permissions.authorize(f.application, new AbortController().signal)).toBe(false);
    expect(f.permissions.state(f.application)).toBe("blocked"); expect(f.prompt).toHaveBeenCalledOnce();
    f.set({ blockedApplications: [] }); expect(await f.permissions.authorize(f.application, new AbortController().signal)).toBe(true);
    expect(f.prompt).toHaveBeenCalledOnce();
  });
  it("does not repeat a refused prompt or grant access after a late response following cancellation", async () => {
    const f = await fixture("deny"); const abort = new AbortController();
    expect(await f.permissions.authorize(f.application, abort.signal)).toBe(false);
    expect(await f.permissions.authorize(f.application, abort.signal)).toBe(false); expect(f.prompt).toHaveBeenCalledOnce();
    f.permissions.clearSession(); f.prompt.mockImplementation(() => { abort.abort(); return Promise.resolve<ComputerAccessDecision>("permanent"); });
    await expect(f.permissions.authorize(f.application, abort.signal)).rejects.toThrow(); expect(f.save).not.toHaveBeenCalled();
  });
});
