import { describe, expect, it } from "vitest";

import type { ModelProfile } from "@agent/protocol";

import { defaultCollapsedProviderIds } from "./model-profile-picker.js";

const models = [
  { modelId: "model-a", providerId: "provider-a" },
  { modelId: "model-b", providerId: "provider-b" },
  { modelId: "model-b-2", providerId: "provider-b" },
] as ModelProfile[];

describe("model profile picker default expansion", () => {
  it("keeps only the selected model provider expanded", () => {
    expect([
      ...defaultCollapsedProviderIds(models, "provider-b", "model-b"),
    ]).toEqual(["provider-a"]);
  });

  it("collapses every provider when the selection is unavailable", () => {
    expect([
      ...defaultCollapsedProviderIds(models, "provider-b", "missing-model"),
    ]).toEqual(["provider-a", "provider-b"]);
  });
});
