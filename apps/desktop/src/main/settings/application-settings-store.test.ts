import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_APPLICATION_SETTINGS, type ApplicationSettings } from "@agent/protocol";

import { ApplicationSettingsStore } from "./application-settings-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("ApplicationSettingsStore", () => {
  it("creates and reads the reusable application defaults", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-app-settings-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "application-settings.json");
    const store = new ApplicationSettingsStore(configurationPath);

    store.ensureFile();

    expect(store.getConfiguration()).toEqual(DEFAULT_APPLICATION_SETTINGS);
    expect(JSON.parse(await readFile(configurationPath, "utf8"))).toEqual(
      DEFAULT_APPLICATION_SETTINGS,
    );
  });

  it("persists general, Agent, permission and appearance edits atomically", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-app-settings-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "application-settings.json");
    const store = new ApplicationSettingsStore(configurationPath);
    const configuration = {
      ...structuredClone(DEFAULT_APPLICATION_SETTINGS),
      appearance: {
        ...DEFAULT_APPLICATION_SETTINGS.appearance,
        themeMode: "dark" as const,
      },
      general: {
        ...DEFAULT_APPLICATION_SETTINGS.general,
        defaultMessageDeliveryMode: "steer" as const,
      },
      permissionPolicies: {
        ...DEFAULT_APPLICATION_SETTINGS.permissionPolicies,
        "command-run": "allow" as const,
      },
    };

    expect(store.saveConfiguration(configuration)).toEqual(configuration);
    expect(store.getConfiguration()).toEqual(configuration);
    expect(JSON.parse(await readFile(configurationPath, "utf8"))).toEqual(configuration);
  });

  it("notifies listeners after the persisted configuration is replaced", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-app-settings-"));
    temporaryDirectories.push(directory);
    const store = new ApplicationSettingsStore(path.join(directory, "application-settings.json"));
    const received: ApplicationSettings[] = [];
    const unsubscribe = store.onChanged((configuration) => received.push(configuration));

    const saved = store.saveConfiguration(structuredClone(DEFAULT_APPLICATION_SETTINGS));

    expect(received).toEqual([saved]);
    unsubscribe();
    store.saveConfiguration({
      ...saved,
      general: { ...saved.general, sendShortcut: "ctrl_enter" },
    });
    expect(received).toHaveLength(1);
  });

  it("adds the queue default when reading settings saved before general options existed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-app-settings-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "application-settings.json");
    const store = new ApplicationSettingsStore(configurationPath);
    const legacyConfiguration = {
      agentDirectory: DEFAULT_APPLICATION_SETTINGS.agentDirectory,
      appearance: DEFAULT_APPLICATION_SETTINGS.appearance,
      permissionPolicies: DEFAULT_APPLICATION_SETTINGS.permissionPolicies,
      version: 1,
    };
    await writeFile(configurationPath, JSON.stringify(legacyConfiguration), "utf8");

    expect(store.getConfiguration().general).toEqual(
      DEFAULT_APPLICATION_SETTINGS.general,
    );
  });
});
