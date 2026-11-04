import { expect, it } from "vitest";
import { isImageGenerationModel } from "./model-purpose.js";

it("separates explicit model purposes and recognizes existing image-only IDs", () => {
  expect(isImageGenerationModel({ modelId: "gpt-image-2.5-flare" })).toBe(true);
  expect(isImageGenerationModel({ modelId: "custom", modelType: "image" })).toBe(true);
  expect(isImageGenerationModel({ modelId: "gpt-image-custom", modelType: "chat" })).toBe(false);
  expect(isImageGenerationModel({ modelId: "gpt-6.1-sol" })).toBe(false);
});
