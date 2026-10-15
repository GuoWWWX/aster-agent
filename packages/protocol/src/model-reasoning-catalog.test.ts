import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_CATALOG, modelCatalogSchema, resolveModelReasoningOptions, upgradeModelReasoningCatalog } from "./model-catalog.js";
import { DEFAULT_MODEL_REASONING_RULES, LEGACY_EXACT_MODEL_REASONING_RULES, modelReasoningRuleSchema } from "./model-reasoning-catalog.js";
import { modelReasoningPatternMatches } from "./model-reasoning-matcher.js";

describe("model-specific reasoning capabilities", () => {
  it.each([
    ["openai-chat-completions", "openai/gpt-6.1-sol", ["low", "medium", "high", "xhigh", "max"]],
    ["openai-responses", "gpt-6-sol", ["none", "low", "medium", "high", "xhigh", "max"]],
    ["openai-responses", "gpt-6-astra", ["low", "medium", "high", "xhigh", "max"]],
    ["openai-responses", "gpt-5.6-sol", ["none", "low", "medium", "high", "xhigh", "max"]],
    ["openai-responses", "gpt-5.6-terra", ["none", "low", "medium", "high", "xhigh", "max"]],
    ["openai-chat-completions", "gpt-5.6-luna", ["none", "low", "medium", "high", "xhigh", "max"]],
    ["openai-chat-completions", "gpt-6-luna", ["none", "low", "medium", "high", "xhigh", "max"]],
    ["openai-responses", "gpt-5", ["minimal", "low", "medium", "high"]],
    ["anthropic-messages", "claude-opus-4-6", ["low", "medium", "high", "max"]],
    ["anthropic-messages", "claude-sonnet-5", ["low", "medium", "high", "xhigh", "max"]],
    ["anthropic-messages", "claude-opus-5-5", ["low", "medium", "high", "xhigh", "max"]],
    ["anthropic-messages", "claude-sonnet-5-5", ["low", "medium", "high", "xhigh", "max"]],
    ["anthropic-messages", "claude-haiku-5-5", ["low", "medium", "high", "xhigh", "max"]],
    ["anthropic-messages", "claude-fable-5-1", ["low", "medium", "high", "xhigh", "max"]],
    ["anthropic-messages", "claude-sonnet-4-5", [1024, 2048, 4096, 8191]],
    ["google-gemini", "models/gemini-3.1-pro-preview", ["low", "medium", "high"]],
    ["google-gemini", "gemini-3-flash-preview", ["minimal", "low", "medium", "high"]],
    ["google-gemini", "gemini-4-argon", ["low", "medium", "high"]],
    ["google-gemini", "gemini-2.5-pro", [-1, 128, 1024, 4096, 8192, 32768]],
    ["openai-chat-completions", "deepseek-v4-pro", ["none", "low", "high", "max"]],
    ["anthropic-messages", "deepseek-v4-pro", ["low", "high", "max"]],
    ["openai-responses", "deepseek-v4-pro", ["none", "low", "high", "max"]],
    ["openai-chat-completions", "kimi-k3", ["low", "high", "max"]],
    ["openai-chat-completions", "glm-5.2", ["low", "high", "max"]],
    ["openai-chat-completions", "qwen-plus", []],
    ["google-gemini", "gpt-6-sol", []],
    ["google-gemini", "gpt-5.6", []],
    ["openai-chat-completions", "unknown-model", []],
  ] as const)("resolves %s / %s", (apiFormat, modelId, expected) => {
    expect(resolveModelReasoningOptions(DEFAULT_MODEL_CATALOG, apiFormat, modelId).map(option => option.value)).toEqual(expected);
  });

  it("lets a later explicit empty override suppress built-in options", () => {
    const catalog = { ...DEFAULT_MODEL_CATALOG, reasoningRules: [...DEFAULT_MODEL_REASONING_RULES,
      { id: "my-rule", name: "Gateway", matches: ["gpt-5.6-*"], apiFormat: "openai-chat-completions" as const, options: [] }] };
    expect(resolveModelReasoningOptions(catalog, "openai-chat-completions", "gpt-5.6-luna")).toEqual([]);
    expect(resolveModelReasoningOptions(catalog, "openai-responses", "gpt-5.6-luna")).toHaveLength(6);
  });

  it("rejects incompatible, duplicate, and unsafe rule inputs", () => {
    const rule = DEFAULT_MODEL_REASONING_RULES[0]!;
    expect(modelReasoningRuleSchema.safeParse({ ...rule, options: [{ kind: "token_budget", value: 1024 }] }).success).toBe(false);
    expect(modelReasoningRuleSchema.safeParse({ ...rule, options: [rule.options[0], rule.options[0]] }).success).toBe(false);
    expect(modelReasoningRuleSchema.safeParse({ ...rule, sourceUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("validates provider references, unique model protocols, and uploaded logo URLs", () => {
    expect(modelCatalogSchema.safeParse(DEFAULT_MODEL_CATALOG).success).toBe(true);
    const rule = DEFAULT_MODEL_REASONING_RULES[0]!;
    const provider = DEFAULT_MODEL_CATALOG.reasoningProviders![0]!;
    expect(modelCatalogSchema.safeParse({ ...DEFAULT_MODEL_CATALOG, reasoningRules: [{ ...rule, providerId: "missing" }] }).success).toBe(false);
    expect(modelCatalogSchema.safeParse({ ...DEFAULT_MODEL_CATALOG, reasoningRules: [rule, { ...rule, id: "duplicate-protocol" }] }).success).toBe(false);
    expect(modelCatalogSchema.safeParse({ ...DEFAULT_MODEL_CATALOG, reasoningProviders: [provider, provider] }).success).toBe(false);
    expect(modelCatalogSchema.safeParse({ ...DEFAULT_MODEL_CATALOG, reasoningProviders: [{ ...provider, apiFormats: [] }] }).success).toBe(false);
    expect(modelCatalogSchema.safeParse({ ...DEFAULT_MODEL_CATALOG, reasoningProviders: [{ ...provider, imageDataUrl: "https://example.test/logo.png" }], reasoningRules: [] }).success).toBe(false);
    expect(modelCatalogSchema.safeParse({ ...DEFAULT_MODEL_CATALOG, reasoningProviders: [{ ...provider, imageDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }], reasoningRules: [] }).success).toBe(false);
    expect(modelCatalogSchema.safeParse({ ...DEFAULT_MODEL_CATALOG, reasoningProviders: [{ ...provider, imageDataUrl: "data:image/png;base64,aGVsbG8=" }], reasoningRules: [] }).success).toBe(true);
  });

  it("retains but stops resolving a provider's unchecked protocol until it is enabled again", () => {
    const catalog = structuredClone(DEFAULT_MODEL_CATALOG);
    const provider = catalog.reasoningProviders!.find(item => item.id === "openai")!;
    provider.apiFormats = ["openai-chat-completions"];
    expect(modelCatalogSchema.safeParse(catalog).success).toBe(true);
    expect(resolveModelReasoningOptions(catalog, "openai-responses", "gpt-6.1-sol")).toEqual([]);
    expect(resolveModelReasoningOptions(catalog, "openai-chat-completions", "gpt-6.1-sol")).toHaveLength(5);
    provider.apiFormats.push("openai-responses");
    expect(resolveModelReasoningOptions(catalog, "openai-responses", "gpt-6.1-sol")).toHaveLength(5);
  });

  it("groups equivalent options while covering every previously listed model and alias", () => {
    for (const provider of DEFAULT_MODEL_CATALOG.reasoningProviders!) {
      const rules = DEFAULT_MODEL_REASONING_RULES.filter(rule => rule.providerId === provider.id);
      expect(rules.length, provider.id).toBeGreaterThan(0);
    }
    expect(DEFAULT_MODEL_REASONING_RULES.length).toBeLessThan(LEGACY_EXACT_MODEL_REASONING_RULES.length / 2);
    expect(DEFAULT_MODEL_REASONING_RULES.every(rule => rule.matchMode === "glob" || rule.matchMode === "exact")).toBe(true);
    for (const rule of LEGACY_EXACT_MODEL_REASONING_RULES) {
      for (const modelId of rule.matches) {
        const matching = DEFAULT_MODEL_REASONING_RULES.filter(candidate => candidate.apiFormat === rule.apiFormat
          && candidate.matches.some(pattern => modelReasoningPatternMatches(pattern, modelId, candidate.matchMode)));
        expect(matching.length, `${modelId} / ${rule.apiFormat}`).toBeGreaterThan(0);
        const expected = modelId === "gpt-6-sol"
          ? LEGACY_EXACT_MODEL_REASONING_RULES.find(candidate => candidate.modelKey === "gpt-6-luna" && candidate.apiFormat === rule.apiFormat)!.options
          : rule.options;
        expect(resolveModelReasoningOptions(DEFAULT_MODEL_CATALOG, rule.apiFormat, modelId), modelId).toEqual(expected);
      }
    }
    expect(resolveModelReasoningOptions(DEFAULT_MODEL_CATALOG, "openai-chat-completions", "gpt-6-unknown")).toEqual([]);
  });

  it("uses simple family wildcards with later exceptions for different capabilities", () => {
    const match = (id: string) => [...DEFAULT_MODEL_REASONING_RULES].reverse().find(rule => rule.matches.some(pattern => modelReasoningPatternMatches(pattern, id, rule.matchMode)))?.modelKey;
    expect(match("gpt-5.6-sol")).not.toBe(match("gpt-5.6-luna"));
    expect(match("gpt-6-luna")).toBe(match("gpt-5.6-luna"));
    expect(match("gpt-6-sol")).toBe(match("gpt-5.6-sol"));
    expect(match("gpt-6.1-sol")).not.toBe(match("gpt-6-sol"));
    expect(match("gpt-6-astra")).not.toBe(match("gpt-6-luna"));
    expect(match("gpt-5.5")).not.toBe(match("gpt-5.5-pro"));
    expect(match("claude-opus-5-5")).toBe(match("claude-sonnet-5-5"));
    expect(match("claude-opus-4-6")).not.toBe(match("claude-opus-5-5"));
    expect(match("gemini-3.1-flash-lite-image")).not.toBe(match("gemini-3.1-flash-lite"));
    expect(match("gpt-6.2-sol")).toBe(match("gpt-6-sol"));
    expect(match("gateway/gpt-6.2-astra")).toBe(match("gpt-6-astra"));
    expect(match("gpt-5.6-sol-2026-10-15")).toBe(match("gpt-6-sol"));
    for (const id of ["gpt-5.6-pro", "claude-haiku-5", "gemini-3.8-pro", "gemini-2.5-flash-image"]) expect(match(id), id).toBeUndefined();
    expect(resolveModelReasoningOptions(DEFAULT_MODEL_CATALOG, "openai-chat-completions", "gpt-5.5-pro")).toEqual([]);
    expect(resolveModelReasoningOptions(DEFAULT_MODEL_CATALOG, "openai-responses", "gpt-6-sol")).toHaveLength(6);
    expect(resolveModelReasoningOptions(DEFAULT_MODEL_CATALOG, "openai-responses", "gpt-5.6-sol-2026-10-15")).toHaveLength(6);
    expect(resolveModelReasoningOptions(DEFAULT_MODEL_CATALOG, "google-gemini", "gemini-3.1-flash-lite-image").map(option => option.value)).toEqual(["minimal", "high"]);
  });

  it("upgrades a complete exact catalog and retains edited exact overrides and custom suffixes", () => {
    const legacy = structuredClone(LEGACY_EXACT_MODEL_REASONING_RULES);
    legacy[0]!.options = [];
    const custom = { ...legacy[0]!, id: DEFAULT_MODEL_REASONING_RULES[0]!.id, modelKey: "custom", matches: ["my-model"] };
    const customGroup = { ...DEFAULT_MODEL_REASONING_RULES[1]!, id: "custom-group", matches: ["my-other-model"] };
    const catalog = { ...DEFAULT_MODEL_CATALOG, reasoningRules: [...legacy, customGroup, custom] };
    expect(modelCatalogSchema.safeParse(catalog).success).toBe(true);
    const upgraded = upgradeModelReasoningCatalog(catalog);
    expect(modelCatalogSchema.safeParse(upgraded).success).toBe(true);
    expect(upgraded.reasoningRules?.at(-1)).toEqual(custom);
    expect(upgraded.reasoningRules?.at(-2)).toEqual(customGroup);
    expect(upgraded.reasoningRules?.find(rule => rule.id === legacy[0]!.id)).toEqual(legacy[0]);
    expect(resolveModelReasoningOptions(upgraded, "openai-chat-completions", "gpt-6.1-sol")).toEqual([]);
    expect(resolveModelReasoningOptions(upgraded, "openai-responses", "gpt-6.1-sol")).toHaveLength(5);
    expect(upgradeModelReasoningCatalog(upgraded)).toBe(upgraded);
    for (const rules of [[], legacy.slice(1), [...legacy].reverse(), legacy.map((rule, index) => index === 0 ? { ...rule, matches: ["custom-*"] } : rule)]) {
      const partial = { ...catalog, reasoningRules: rules };
      expect(upgradeModelReasoningCatalog(partial)).toBe(partial);
    }
  });

  it("distinguishes exact, wildcard and regex matching and rejects invalid regex at save time", () => {
    expect(modelReasoningPatternMatches("claude-opus-5-5", "anthropic/CLAUDE-OPUS-5-5", "exact")).toBe(true);
    expect(modelReasoningPatternMatches("claude-*", "claude-opus-5-5", "exact")).toBe(false);
    expect(modelReasoningPatternMatches("claude-*", "claude-opus-5-5", "glob")).toBe(true);
    expect(modelReasoningPatternMatches("^claude-(opus|sonnet)-5(-5)?$", "anthropic/claude-sonnet-5-5", "regex")).toBe(true);
    expect(modelReasoningPatternMatches("^claude-(opus|sonnet)-5(-5)?$", "claude-haiku-5-5", "regex")).toBe(false);
    expect(modelReasoningPatternMatches("[", "anything", "regex")).toBe(false);
    const rule = DEFAULT_MODEL_REASONING_RULES[0]!;
    expect(modelReasoningRuleSchema.safeParse({ ...rule, matchMode: "regex", matches: ["["] }).success).toBe(false);
    expect(modelReasoningRuleSchema.safeParse({ ...rule, matchMode: "regex", matches: ["(a+)+$"] }).success).toBe(true);
    expect(modelReasoningPatternMatches("(a+)+$", `${"a".repeat(10000)}!`, "regex")).toBe(false);
    const catalog = { ...DEFAULT_MODEL_CATALOG, reasoningRules: [{ ...rule, matchMode: "regex" as const, matches: ["^my-model-[0-9]{1,3}$"] }] };
    expect(resolveModelReasoningOptions(catalog, rule.apiFormat, "my-model-12")).toEqual(rule.options);
  });
});
