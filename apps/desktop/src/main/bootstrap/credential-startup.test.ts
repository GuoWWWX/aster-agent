import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { safeStorage } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    decryptString: (value: Buffer) => value.toString("utf8"),
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    isEncryptionAvailable: () => true,
  },
}));

import { ModelCredentialStore } from "../model/model-credential-store.js";
import { SettingsJsoncFile } from "../settings/settings-jsonc-file.js";
import { initializeAgentHome } from "../storage/agent-home.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("Credential startup migration", () => {
  it("uses the existing JSONC key when migrating the former home instead of decrypting its older shadow file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-model-home-migration-"));
    temporaryDirectories.push(directory);
    const legacyRootPath = path.join(directory, ".agent");
    await mkdir(legacyRootPath);
    const legacyPath = path.join(legacyRootPath, "model-credentials.json");
    const legacy = new ModelCredentialStore(legacyPath);
    const input = {
      apiKey: "old-key", apiFormat: "openai-responses" as const, baseUrl: "https://example.test/v1",
      models: [{ modelId: "test", displayName: "test", contextWindow: 0, reasoningOptions: [] }], providerName: "旧供应商",
    };
    const { providerId } = legacy.saveConfiguration(input);
    if (providerId === null) throw new Error("Expected a saved provider.");
    const previousSettings = new SettingsJsoncFile(path.join(legacyRootPath, "settings.jsonc"));
    new ModelCredentialStore(previousSettings).saveConfiguration({ ...input, apiKey: "current-jsonc-key", providerId });
    const original = await readFile(previousSettings.path, "utf8");
    vi.spyOn(safeStorage, "isEncryptionAvailable").mockReturnValue(false);
    const decrypt = vi.spyOn(safeStorage, "decryptString").mockImplementation(() => { throw new Error("old key unavailable"); });

    const options = { environment: {}, homeDirectory: directory, legacyRootPath: path.join(directory, "electron") };
    const result = await initializeAgentHome(options);
    const store = new ModelCredentialStore(new SettingsJsoncFile(result.paths.settingsPath), result.paths.credentialsPath);
    store.importFromEnvironment();

    expect(store.getConfiguration().apiKey).toBe("current-jsonc-key");
    expect(await readFile(result.paths.settingsPath, "utf8")).toBe(original);
    expect(await readFile(previousSettings.path, "utf8")).toBe(original);
    expect(decrypt).not.toHaveBeenCalled();
    await initializeAgentHome(options);
    const restarted = new ModelCredentialStore(new SettingsJsoncFile(result.paths.settingsPath), result.paths.credentialsPath);
    restarted.importFromEnvironment();
    expect(restarted.getConfiguration().apiKey).toBe("current-jsonc-key");
    expect(decrypt).not.toHaveBeenCalled();
  });
});
