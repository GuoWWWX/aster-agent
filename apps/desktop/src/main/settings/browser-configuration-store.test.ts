import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_CONFIGURATION } from "@agent/protocol";

import { BrowserConfigurationStore } from "./browser-configuration-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("BrowserConfigurationStore", () => {
  it("returns the browser defaults before the first save", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-browser-"));
    temporaryDirectories.push(directory);
    const store = new BrowserConfigurationStore(path.join(directory, "missing.json"));

    expect(store.getConfiguration()).toEqual(DEFAULT_BROWSER_CONFIGURATION);
  });

  it("validates and atomically persists browser settings", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-browser-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "browser-settings.json");
    const store = new BrowserConfigurationStore(configurationPath);
    const configuration = {
      askForDownloadLocation: true,
      defaultZoomPercent: 125,
      searchEngine: "duckduckgo" as const,
      version: 1 as const,
    };

    expect(store.saveConfiguration(configuration)).toEqual(configuration);
    expect(store.getConfiguration()).toEqual(configuration);
    expect(JSON.parse(await readFile(configurationPath, "utf8"))).toEqual(configuration);
  });

  it("fills new browser settings when reading an older configuration", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-browser-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "browser-settings.json");
    await writeFile(configurationPath, JSON.stringify({ defaultZoomPercent: 125, version: 1 }));

    expect(new BrowserConfigurationStore(configurationPath).getConfiguration()).toEqual({
      askForDownloadLocation: false,
      defaultZoomPercent: 125,
      searchEngine: "google",
      version: 1,
    });
  });
});
