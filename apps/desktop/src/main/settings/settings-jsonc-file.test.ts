import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DEFAULT_APPLICATION_SETTINGS } from "@agent/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { ApplicationSettingsStore } from "./application-settings-store.js";
import { SettingsJsoncFile } from "./settings-jsonc-file.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })
  ));
});

describe("SettingsJsoncFile", () => {
  it("preserves comments and unrelated sections when updating one value", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-settings-jsonc-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "settings.jsonc");
    await writeFile(configurationPath, `{
  // 用户备注必须保留。
  "version": 1,
  "custom": { "keep": true },
}
`, "utf8");
    const settings = new SettingsJsoncFile(configurationPath);

    settings.write("terminal", z.object({ shell: z.string() }), { shell: "pwsh" });

    const content = await readFile(configurationPath, "utf8");
    expect(content).toContain("// 用户备注必须保留。");
    expect(settings.readValue("custom")).toEqual({ keep: true });
    expect(settings.readValue("terminal")).toEqual({ shell: "pwsh" });
  });

  it("stores application settings in the documented root sections", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-settings-sections-"));
    temporaryDirectories.push(directory);
    const settings = new SettingsJsoncFile(path.join(directory, "settings.jsonc"));
    const store = new ApplicationSettingsStore(settings);

    store.ensureFile();
    const changed = {
      ...DEFAULT_APPLICATION_SETTINGS,
      appearance: { ...DEFAULT_APPLICATION_SETTINGS.appearance, themeMode: "dark" as const },
    };
    store.saveConfiguration(changed);

    expect(store.getConfiguration()).toEqual(changed);
    expect(settings.readValue("appearance")).toEqual(changed.appearance);
    expect(settings.readValue("agents")).toEqual(changed.agentDirectory.agents);
    expect(settings.readValue("agentDirectory")).toBeUndefined();
  });

  it("rejects malformed JSONC without replacing the source file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-settings-invalid-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "settings.jsonc");
    const invalid = '{ "version": 1, "terminal": ';
    await writeFile(configurationPath, invalid, "utf8");
    const settings = new SettingsJsoncFile(configurationPath);

    expect(() => settings.readValue("terminal")).toThrow("Unable to parse settings");
    await expect(readFile(configurationPath, "utf8")).resolves.toBe(invalid);
  });
});
