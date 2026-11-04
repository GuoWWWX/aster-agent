import { describe, expect, it } from "vitest";

import {
  clampWorkflowCanvasPosition,
  workflowCanvasPositionFromPointer,
} from "./team-workflow-canvas.js";

describe("team workflow canvas positioning", () => {
  it("keeps the grabbed point under the pointer while a node moves", () => {
    expect(workflowCanvasPositionFromPointer(
      460,
      290,
      { left: 100, top: 40 },
      { offsetX: 35, offsetY: 20 },
    )).toEqual({ x: 325, y: 230 });
  });

  it("keeps nodes fully inside the canvas", () => {
    expect(clampWorkflowCanvasPosition({ x: -80, y: -20 })).toEqual({ x: 15, y: 15 });
    expect(clampWorkflowCanvasPosition({ x: 4_000, y: 4_000 })).toEqual({ x: 1_565, y: 633 });
  });
});
