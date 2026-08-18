import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ContextCompressionConfigurationStore } from "./context-compression-configuration-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe("ContextCompressionConfigurationStore", () => {
  it("returns defaults until a configuration is saved and persists both thresholds", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-context-compression-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "context-compression-settings.json");
    const store = new ContextCompressionConfigurationStore(configurationPath);

    expect(store.getConfiguration()).toEqual({
      mode: "percentage",
      percentageThreshold: 80,
      tokenThreshold: 100_000,
      version: 1,
    });
    store.ensureFile();
    await expect(readFile(configurationPath, "utf8")).resolves.toContain('"percentageThreshold": 80');

    expect(store.saveConfiguration({
      mode: "tokens",
      percentageThreshold: 75,
      tokenThreshold: 64_000,
      version: 1,
    })).toEqual({
      mode: "tokens",
      percentageThreshold: 75,
      tokenThreshold: 64_000,
      version: 1,
    });
    await expect(readFile(configurationPath, "utf8")).resolves.toContain('"tokenThreshold": 64000');

    expect(new ContextCompressionConfigurationStore(configurationPath).getConfiguration()).toEqual({
      mode: "tokens",
      percentageThreshold: 75,
      tokenThreshold: 64_000,
      version: 1,
    });
  });
});
