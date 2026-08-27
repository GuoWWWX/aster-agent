import { describe, expect, it } from "vitest";

import {
  PROVIDER_ICON_OPTIONS,
  providerIconLabel,
  providerInitials,
} from "./provider-logo.js";

describe("provider logo presentation", () => {
  it("uses one or two readable characters when no brand icon is selected", () => {
    expect(providerInitials("供应商服务")).toBe("供应");
    expect(providerInitials("ai.hththt.top")).toBe("AH");
    expect(providerInitials("OpenAI")).toBe("OP");
    expect(providerInitials("  ")).toBe("?");
  });

  it("offers local brand icons for common model providers and gateways", () => {
    const selected = new Map(PROVIDER_ICON_OPTIONS.map((option) => [option.value, option]));

    expect(selected.get("openai")?.brandIcon).toBeDefined();
    expect(selected.get("anthropic")?.brandIcon).toBeDefined();
    expect(selected.get("deepseek")?.brandIcon).toBeDefined();
    expect(selected.get("openrouter")?.brandIcon).toBeDefined();
    expect(selected.get("replicate")?.brandIcon).toBeDefined();
    expect(providerIconLabel("auto")).toBe("自动首字母");
    expect(providerIconLabel("new-api")).toBe("New API");
  });
});
