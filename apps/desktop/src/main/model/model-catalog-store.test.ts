import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ModelCatalogStore } from "./model-catalog-store.js";
import { SettingsJsoncFile } from "../settings/settings-jsonc-file.js";
import { DEFAULT_MODEL_CATALOG } from "@agent/protocol";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("ModelCatalogStore", () => {
  it("saves protocol-specific reasoning rules into settings.jsonc and preserves other settings", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-model-catalog-settings-"));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, "settings.jsonc");
    await writeFile(filename, '{\n// user comment\n"version": 1, "customSetting": true\n}', "utf8");
    const file = new SettingsJsoncFile(filename);
    const store = new ModelCatalogStore(file);
    const next = { ...DEFAULT_MODEL_CATALOG, reasoningRules: [{ id: "custom", name: "Gateway", providerId: "openai", modelKey: "gateway",
      matches: ["my-model"], apiFormat: "openai-responses" as const, options: [{ kind: "custom_effort" as const, value: "deep" }] }] };
    store.saveCatalog(next);
    expect(new ModelCatalogStore(new SettingsJsoncFile(filename)).getCatalog()).toEqual(next);
    const saved = await readFile(filename, "utf8");
    expect(saved).toContain("// user comment");
    expect(file.readValue("customSetting")).toBe(true);
    expect(() => store.saveCatalog({ ...next, reasoningRules: [{ ...next.reasoningRules[0]!, matches: [] }] })).toThrow();
    expect(store.getCatalog()).toEqual(next);
  });
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
