import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ModelCatalogStore } from "./model-catalog-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("ModelCatalogStore", () => {
  it("creates a user-editable catalog when none exists", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-model-catalog-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "model-catalog.json");
    const store = new ModelCatalogStore(configurationPath);

    const catalog = store.getCatalog();

    expect(catalog.version).toBe(1);
    expect(catalog.defaultContextWindow).toBe(128_000);
    expect(catalog.models.some((model) => model.id === "openai-gpt-5.6")).toBe(true);
    expect(JSON.parse(await readFile(configurationPath, "utf8"))).toEqual(catalog);
  });

  it("preserves user-maintained catalog entries", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-model-catalog-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "model-catalog.json");
    const userCatalog = {
      defaultContextWindow: 64_000,
      models: [{
        contextWindow: 256_000,
        id: "private-model",
        matches: ["private-chat-*"],
        name: "Private Chat",
      }],
      version: 1,
    };
    await writeFile(configurationPath, JSON.stringify(userCatalog), "utf8");
    const store = new ModelCatalogStore(configurationPath);

    store.ensureFile();

    expect(store.getCatalog()).toEqual(userCatalog);
  });
});
