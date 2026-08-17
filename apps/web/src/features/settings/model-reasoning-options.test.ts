import { describe, expect, it } from "vitest";

import {
  defaultModelContextWindow,
  defaultReasoningOptions,
  reasoningOptionLabel,
  reorderReasoningOptions,
} from "./model-reasoning-options.js";

describe("model reasoning option helpers", () => {
  it("uses the configured display name and preserves option order when reordered", () => {
    const options = [
      { displayName: "高", enabled: true, kind: "effort" as const, value: "high" as const },
      { displayName: "低", enabled: false, kind: "effort" as const, value: "low" as const },
      { displayName: "自定义", enabled: true, kind: "custom_effort" as const, value: "deep" },
    ];

    expect(reasoningOptionLabel(options[2]!)).toBe("自定义 | deep");
    expect(reorderReasoningOptions(options, "effort:deep", "effort:high")).toEqual([
      options[2],
      options[0],
      options[1],
    ]);
  });

  it("provides API-compatible defaults for reset", () => {
    expect(defaultReasoningOptions("openai-chat-completions")).toMatchObject([
      { displayName: "低", kind: "effort", value: "low" },
      { displayName: "中", kind: "effort", value: "medium" },
      { displayName: "高", kind: "effort", value: "high" },
    ]);
    expect(defaultReasoningOptions("openai-responses")).toHaveLength(4);
    expect(defaultReasoningOptions("openai-responses", "gpt-5.6")).toMatchObject([
      { displayName: "无", kind: "effort", value: "none" },
      { displayName: "低", kind: "effort", value: "low" },
      { displayName: "中", kind: "effort", value: "medium" },
      { displayName: "高", kind: "effort", value: "high" },
      { displayName: "极高", kind: "effort", value: "xhigh" },
      { displayName: "最高", kind: "effort", value: "max" },
    ]);
    expect(defaultReasoningOptions("anthropic-messages").map((option) => option.value)).toEqual([
      1_024,
      2_048,
      4_096,
      8_191,
    ]);
    expect(defaultReasoningOptions("google-gemini").map((option) => option.value)).toEqual([
      0,
      1_024,
      4_096,
      8_192,
    ]);
    expect(defaultReasoningOptions("google-gemini", "gemini-3.1-pro-preview")).toMatchObject([
      { displayName: "低", kind: "effort", value: "low" },
      { displayName: "高", kind: "effort", value: "high" },
    ]);
  });

  it("uses the model context-window default when one is known", () => {
    expect(defaultModelContextWindow("gpt-5.6")).toBe(1_050_000);
    expect(defaultModelContextWindow("gpt-5.6-sol")).toBe(1_050_000);
    expect(defaultModelContextWindow("gpt-5.6-terra")).toBe(1_050_000);
    expect(defaultModelContextWindow("gpt-5.6-sol-2026-08-01")).toBe(1_050_000);
    expect(defaultModelContextWindow("gpt-4.1")).toBe(1_047_576);
    expect(defaultModelContextWindow("unknown-model")).toBe(128_000);
  });
});
