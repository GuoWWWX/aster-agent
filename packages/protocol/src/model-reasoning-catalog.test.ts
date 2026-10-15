import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_CATALOG, modelCatalogSchema, resolveModelReasoningOptions } from "./model-catalog.js";
import { DEFAULT_MODEL_REASONING_RULES, modelReasoningRuleSchema } from "./model-reasoning-catalog.js";
import { modelReasoningPatternMatches } from "./model-reasoning-matcher.js";

describe("model-specific reasoning capabilities", () => {
  it.each([
    ["openai-chat-completions", "openai/gpt-6.1-sol", ["low", "medium", "high", "xhigh", "max"]],
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

  it("lists concrete models under all nine providers and does not invent unknown model levels", () => {
    for (const provider of DEFAULT_MODEL_CATALOG.reasoningProviders!) {
      const rules = DEFAULT_MODEL_REASONING_RULES.filter(rule => rule.providerId === provider.id);
      expect(rules.length, provider.id).toBeGreaterThan(0);
      expect(rules.every(rule => rule.matchMode === "exact" && rule.name === rule.modelKey)).toBe(true);
    }
    expect(resolveModelReasoningOptions(DEFAULT_MODEL_CATALOG, "openai-chat-completions", "gpt-6-unknown")).toEqual([]);
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
    expect(resolveModelReasoningOptions(catalog, rule.apiFormat, "my-model-12")).toHaveLength(5);
  });
});
