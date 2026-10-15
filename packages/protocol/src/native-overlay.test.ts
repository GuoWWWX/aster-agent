import { describe, expect, it } from "vitest";
import { nativeOverlayRegionsInputSchema } from "./native-overlay.js";

describe("native overlay regions", () => {
  const region = { x: 0, y: 0, width: 16_384, height: 100 };

  it("accepts empty regions and bounded integer rectangles", () => {
    expect(nativeOverlayRegionsInputSchema.parse({ regions: [], interactive: false }).regions).toEqual([]);
    expect(nativeOverlayRegionsInputSchema.parse({ regions: [region], interactive: true }).regions).toEqual([region]);
  });

  it.each([-1, 1.5, 16_385, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid coordinates: %s", (x) => {
    expect(nativeOverlayRegionsInputSchema.safeParse({ regions: [{ ...region, x }], interactive: true }).success).toBe(false);
  });

  it("rejects extra fields, more than 64 regions and missing interaction state", () => {
    for (const input of [
      { regions: [{ ...region, ignored: true }], interactive: true },
      { regions: [region], interactive: true, ignored: true },
      { regions: Array.from({ length: 65 }, () => region), interactive: true },
      { regions: [region] },
    ]) expect(nativeOverlayRegionsInputSchema.safeParse(input).success).toBe(false);
  });
});
