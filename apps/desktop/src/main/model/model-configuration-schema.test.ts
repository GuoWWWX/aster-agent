import { describe, expect, it } from "vitest";
import { parseLegacyModelConfiguration, settingsModelConfigurationSchema } from "./model-configuration-schema.js";

const providerId = "00000000-0000-4000-8000-000000000002";
const model = { contextWindow: 128000, displayName: "Configured model", modelId: "fixture-model" };
const provider = { baseUrl: "https://provider.test/v1", encryptedApiKey: "opaque-key-bytes", id: providerId,
  models: [model], name: "Configured provider" };
const defaults = { defaultModelId: model.modelId, defaultProviderId: providerId };
const versions: unknown[] = [
  { version: 1, baseUrl: provider.baseUrl, encryptedApiKey: provider.encryptedApiKey, modelId: model.modelId },
  { version: 2, baseUrl: provider.baseUrl, encryptedApiKey: provider.encryptedApiKey, defaultModelId: model.modelId, models: [model] },
  { version: 3, ...defaults, providers: [provider] },
  { version: 4, ...defaults, providers: [{ ...provider, apiFormat: "anthropic-messages" }] },
  { version: 5, ...defaults, providers: [{ ...provider, apiFormat: "google-gemini", models: [{ ...model, reasoningOptions: [] }] }] },
  { version: 6, ...defaults, recentSelection: null,
    providers: [{ ...provider, apiFormat: "openai-responses", models: [{ ...model, reasoningOptions: [] }] }] },
];

describe("stored model configuration compatibility", () => {
  it.each(versions.map((input, index) => ({ input, version: index + 1 })))(
    "upgrades V$version without decrypting or mutating its credential record", ({ input, version }) => {
      const before = structuredClone(input);
      const stored = parseLegacyModelConfiguration(input);
      expect(stored.version).toBe(6);
      expect(stored.defaultModelId).toBe(model.modelId);
      expect(stored.recentSelection).toBeNull();
      expect(stored.providers[0]?.encryptedApiKey).toBe(provider.encryptedApiKey);
      expect(stored.providers[0]?.models[0]?.modelId).toBe(model.modelId);
      expect(stored.providers[0]?.models[0]?.reasoningOptions).toEqual([]);
      expect(stored.providers[0]?.apiFormat).toBe(
        version <= 3 ? "openai-chat-completions" : version === 4 ? "anthropic-messages" : version === 5 ? "google-gemini" : "openai-responses",
      );
      expect(input).toEqual(before);
    },
  );

  it("rejects a default model outside the stored provider and unsupported future versions", () => {
    const current = versions[5];
    if (typeof current !== "object" || current === null) throw new Error("Expected current fixture");
    expect(() => parseLegacyModelConfiguration({ ...current, defaultModelId: "missing" })).toThrow();
    expect(() => parseLegacyModelConfiguration({ ...current, version: 7 })).toThrow();
  });

  it("accepts an empty JSONC configuration but rejects a dangling default model selection", () => {
    expect(settingsModelConfigurationSchema.parse({ providers: [], defaultModelSelection: null, recentSelection: null }))
      .toEqual({ providers: [], defaultModelSelection: null, recentSelection: null });
    expect(() => settingsModelConfigurationSchema.parse({ providers: [], recentSelection: null,
      defaultModelSelection: { providerId, modelId: model.modelId, reasoning: null } })).toThrow();
  });
});
