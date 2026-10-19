import { mkdtemp, readFile, rm, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_COMPUTER_USE_CONFIGURATION } from "@agent/protocol";
import { SettingsJsoncFile } from "./settings-jsonc-file.js";
import { ComputerUseConfigurationStore } from "./computer-use-configuration-store.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe.runIf(process.platform === "win32")("ComputerUseConfigurationStore", () => {
  it("preserves unrelated JSONC settings and canonicalizes explicitly selected software", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-computer-settings-")); roots.push(directory);
    const file = path.join(directory, "settings.jsonc");
    await writeFile(file, '{\n // keep this comment\n "version":1, "browser":{"searchEngine":"google"}\n}');
    const store = new ComputerUseConfigurationStore(new SettingsJsoncFile(file));
    expect(store.getConfiguration()).toEqual(DEFAULT_COMPUTER_USE_CONFIGURATION);
    const exe = path.join(directory, "editor.exe"); await writeFile(exe, "fixture");
    const saved = store.saveConfiguration({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, enabled: true, applications: [{ id: "11111111-1111-4111-8111-111111111111", name: "编辑器", executablePath: exe, enabled: true }] });
    expect(saved.applications[0]?.executablePath).toBe(await realpath(exe));
    expect(store.getConfiguration()).toEqual(saved);
    const text = await readFile(file, "utf8"); expect(text).toContain("keep this comment"); expect(text).toContain("searchEngine");
    expect(() => store.saveConfiguration({ ...saved, applications: [{ ...saved.applications[0]!, executablePath: path.join(directory, "missing.exe") }] })).toThrow();
    expect(store.getConfiguration()).toEqual(saved);
  });
  it("retains a grant approved after the settings snapshot and applies an explicit later revocation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-computer-settings-")); roots.push(directory);
    const file = path.join(directory, "settings.jsonc"); const executablePath = path.join(directory, "editor.exe"); await writeFile(executablePath, "fixture");
    const store = new ComputerUseConfigurationStore(new SettingsJsoncFile(file)); const baseline = store.getConfiguration();
    const grant = { id: "11111111-1111-4111-8111-111111111111", name: "Editor", executablePath, enabled: true };
    const approved = store.saveConfiguration({ ...baseline, applications: [grant] });
    const merged = store.saveConfiguration({ ...baseline, administrator: true }, baseline.applications);
    expect(merged.applications).toEqual(approved.applications); expect(merged.administrator).toBe(true);
    expect(new ComputerUseConfigurationStore(new SettingsJsoncFile(file)).getConfiguration()).toEqual(merged);
    expect(store.saveConfiguration({ ...merged, applications: [] }, merged.applications).applications).toEqual([]);
  });
});
