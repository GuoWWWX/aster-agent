import { describe, expect, it } from "vitest";
import { nativeOverlayRegionsInputSchema, nativeOverlayTooltipPointerSchema } from "./native-overlay.js";

describe("native overlay regions", () => {
  const region = { x: 0, y: 0, width: 16_384, height: 100 };
  it("accepts tooltip tracking and finite cursor positions outside the window", () => {
    expect(nativeOverlayRegionsInputSchema.parse({ regions: [region], interactive: false, tooltipOnly: true }).tooltipOnly).toBe(true);
    expect(nativeOverlayTooltipPointerSchema.parse({ x: -200, y: 12.5 })).toEqual({ x: -200, y: 12.5 });
    for (const input of [{ x: Infinity, y: 0 }, { x: NaN, y: 0 }, { x: 0, y: 0, channel: "application" }]) {
      expect(nativeOverlayTooltipPointerSchema.safeParse(input).success).toBe(false);
    }
  });

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
