// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkflowDesigner } from "./team-workflow-designer.js";

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("WorkflowDesigner", () => {
  it("adds palette nodes inside the canvas without creating an edge", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<WorkflowDesigner />));

    const canvas = container.querySelector(".workflow-canvas");
    const paletteButton = [...container.querySelectorAll<HTMLButtonElement>(".workflow-canvas-toolbar__palette > button")]
      .find((button) => button.textContent?.includes("模型节点"));
    const nodeCount = container.querySelectorAll(".workflow-canvas-node").length;
    const edgeCount = container.querySelectorAll(".workflow-canvas__edges > path").length;

    expect(canvas?.querySelector(".workflow-canvas-toolbar")).not.toBeNull();
    expect(paletteButton).toBeDefined();
    act(() => paletteButton?.click());

    expect(container.querySelectorAll(".workflow-canvas-node")).toHaveLength(nodeCount + 1);
    expect(container.querySelectorAll(".workflow-canvas__edges > path")).toHaveLength(edgeCount);
  });
});
