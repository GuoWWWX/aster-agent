import { expect, it } from "vitest";
import { DEFAULT_MODEL_REASONING_RULES } from "@agent/protocol";
import { reasoningCatalogModels, reasoningCatalogModelMatchesSearch } from "./model-reasoning-catalog-draft.js";
import { MODEL_REASONING_INVENTORY } from "./model-reasoning-inventory.js";

it.each(Object.entries(MODEL_REASONING_INVENTORY))("makes every researched %s ID discoverable through a configured group", (providerId, inventory) => {
  const models = reasoningCatalogModels(DEFAULT_MODEL_REASONING_RULES).filter(model => model.providerId === providerId);
  expect(new Set(inventory.modelIds).size).toBe(inventory.modelIds.length);
  for (const modelId of inventory.modelIds) {
    expect(models.some(model => model.knownModelIds.includes(modelId)), modelId).toBe(true);
    expect(models.some(model => reasoningCatalogModelMatchesSearch(model, "", modelId)), modelId).toBe(true);
  }
  expect(inventory.sourceUrls.every(url => url.startsWith("https://"))).toBe(true);
});

it("reflects actual rule precedence, exact overrides and unknown custom providers", () => {
  const source = DEFAULT_MODEL_REASONING_RULES.find(rule => rule.modelKey === "claude-latest")!;
  const override = { ...source, id: "fable-only", modelKey: "fable-only", matchMode: "exact" as const, matches: ["claude-fable-5-1"], options: [] };
  const rules = [...DEFAULT_MODEL_REASONING_RULES, override, { ...override, id: "custom", modelKey: "custom", providerId: "private" }];
  const before = structuredClone(rules);
  const models = reasoningCatalogModels(rules);
  expect(models.find(model => model.key === "claude-latest")?.knownModelIds).not.toContain("claude-fable-5-1");
  expect(models.find(model => model.key === "fable-only")?.knownModelIds).toEqual(["claude-fable-5-1"]);
  expect(models.find(model => model.key === "custom")?.knownModelIds).toEqual([]);
  expect(models.find(model => model.key === "gemini-flash")?.knownModelIds).not.toContain("gemini-3.1-flash-lite-image");
  expect(rules).toEqual(before);
});
