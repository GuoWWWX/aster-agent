import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_TERMINAL_CONFIGURATION } from "@agent/protocol";

import { TerminalConfigurationStore } from "./terminal-configuration-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("TerminalConfigurationStore", () => {
  it("returns the automatic decoding defaults before the first save", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-terminal-"));
    temporaryDirectories.push(directory);
    const store = new TerminalConfigurationStore(path.join(directory, "missing.json"));

    expect(store.getConfiguration()).toEqual(DEFAULT_TERMINAL_CONFIGURATION);
  });

  it("upgrades earlier default fonts to the Windows Terminal-compatible font stack", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-terminal-"));
    temporaryDirectories.push(directory);
    const store = new TerminalConfigurationStore(path.join(directory, "terminal-settings.json"));
    for (const fontFamily of [
      "Cascadia Mono, Consolas, 'Microsoft YaHei UI', monospace",
      "'CodeNewRoman Nerd Font Mono', 'Cascadia Mono', 'Segoe UI Emoji', 'Microsoft YaHei UI', Consolas, monospace",
    ]) {
      store.saveConfiguration({ ...DEFAULT_TERMINAL_CONFIGURATION, fontFamily });
      expect(store.getConfiguration().fontFamily).toBe(DEFAULT_TERMINAL_CONFIGURATION.fontFamily);
    }
  });

  it("validates and atomically persists terminal settings", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-terminal-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "terminal-settings.json");
    const store = new TerminalConfigurationStore(configurationPath);
    const configuration = {
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 14,
      lineHeight: 1.65,
      outputEncoding: "gb18030" as const,
      shell: "pwsh" as const,
      shellPaths: {
        bash: "",
        cmd: "",
        powershell: "",
        pwsh: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      },
      version: 1 as const,
    };

    expect(store.saveConfiguration(configuration)).toEqual(configuration);
    expect(store.getConfiguration()).toEqual(configuration);
    expect(JSON.parse(await readFile(configurationPath, "utf8"))).toEqual(configuration);
  });
});
