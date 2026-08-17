import { describe, expect, it } from "vitest";

import {
  clampResizablePanelWidth,
  getResizeCollapseTransition,
  getResizedPanelWidth,
} from "./resizable-divider.js";

describe("ResizableDivider helpers", () => {
  it("clamps a requested width to the configured range", () => {
    expect(clampResizablePanelWidth(189.4, 220, 420)).toBe(220);
    expect(clampResizablePanelWidth(320.6, 220, 420)).toBe(321);
    expect(clampResizablePanelWidth(480, 220, 420)).toBe(420);
  });

  it("uses the correct drag direction for each sidebar", () => {
    expect(getResizedPanelWidth(288, 40, "from-start")).toBe(328);
    expect(getResizedPanelWidth(280, 40, "from-end")).toBe(240);
  });

  it("collapses and restores after crossing the resize threshold", () => {
    expect(getResizeCollapseTransition(196, 220, 24, false)).toBe("collapse");
    expect(getResizeCollapseTransition(244, 220, 24, true)).toBe("expand");
    expect(getResizeCollapseTransition(220, 220, 24, false)).toBeNull();
    expect(getResizeCollapseTransition(220, 220, 24, true)).toBeNull();
  });
});
