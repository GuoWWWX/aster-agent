import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_CATALOG,
  modelCatalogPatternMatches,
  modelCatalogSchema,
  resolveModelCatalogRule,
  resolveModelContextWindow,
} from "./model-catalog.js";

describe("model catalog", () => {
  it("matches model identifiers case-insensitively and without provider prefixes", () => {
    expect(modelCatalogPatternMatches("gpt-5.6-*", "openai/GPT-5.6-Terra")).toBe(true);
    expect(modelCatalogPatternMatches("gpt-5.6-*", "gpt-5.5")).toBe(false);
  });

  it("uses curated defaults for known models and a fallback for unknown models", () => {
    expect(resolveModelContextWindow(DEFAULT_MODEL_CATALOG, "gpt-5.6-luna")).toBe(1_050_000);
    expect(resolveModelContextWindow(DEFAULT_MODEL_CATALOG, "openai/gpt-4.1-mini")).toBe(1_047_576);
    expect(resolveModelContextWindow(DEFAULT_MODEL_CATALOG, "claude-sonnet-4-6")).toBe(1_000_000);
    expect(resolveModelContextWindow(DEFAULT_MODEL_CATALOG, "unknown-provider-model")).toBe(128_000);
  });

  it("uses the last matching user rule so appended overrides win", () => {
    const catalog = modelCatalogSchema.parse({
      defaultContextWindow: 16_000,
      models: [
        {
          contextWindow: 1_050_000,
          id: "fallback",
          matches: ["gpt-*"],
          name: "Fallback",
        },
        {
          contextWindow: 512_000,
          id: "user-override",
          matches: ["gpt-5.6"],
          name: "My GPT-5.6",
        },
      ],
      version: 1,
    });

    expect(resolveModelCatalogRule(catalog, "gpt-5.6")?.id).toBe("user-override");
    expect(resolveModelContextWindow(catalog, "gpt-5.6")).toBe(512_000);
    expect(resolveModelContextWindow(catalog, "other")).toBe(16_000);
  });
});
