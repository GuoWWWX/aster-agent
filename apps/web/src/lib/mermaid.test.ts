// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ configuration: "", observed: [] as string[] }));
vi.mock("mermaid", () => ({ default: {
  initialize: (configuration: { securityLevel: string; themeVariables: { primaryTextColor: string } }) => {
    expect(configuration.securityLevel).toBe("strict");
    fake.configuration = configuration.themeVariables.primaryTextColor;
  },
  render: async (_id: string, source: string) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    fake.observed.push(fake.configuration);
    if (source === "invalid") throw new Error("syntax");
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0, 0, 1e2, 5e1"></svg>' };
  },
} }));
import { getCachedMermaidSvg, measureSvg, normalizeMermaidSource, renderMermaid } from "./mermaid.js";

describe("shared Mermaid rendering", () => {
  it("normalizes directions and reads scientific or comma-separated SVG dimensions", () => {
    expect(normalizeMermaidSource("flowchart lr\nsubgraph X\ndirection tb\nend")).toBe("flowchart LR\nsubgraph X\ndirection TB\nend");
    expect(measureSvg('<svg viewBox="0, 0, 1e2, 5e1"/>')).toEqual({ width: 100, height: 50 });
    expect(measureSvg('<svg width="1.2e3px" height="500"/>')).toEqual({ width: 1200, height: 500 });
  });
  it("isolates simultaneous light and dark renders, caches each theme and recovers after errors", async () => {
    const light = renderMermaid("flowchart LR\nA-->B", false);
    const dark = renderMermaid("flowchart LR\nC-->D", true);
    await expect(renderMermaid("flowchart LR\nA-->B", false)).resolves.toEqual(await light);
    await dark;
    expect(fake.observed).toHaveLength(2);
    expect(fake.observed[0]).not.toEqual(fake.observed[1]);
    expect(getCachedMermaidSvg("flowchart lr\nA-->B", false)?.width).toBe(100);
    await expect(renderMermaid("invalid", true)).rejects.toThrow("syntax");
    await expect(renderMermaid("flowchart TB\nE-->F", false)).resolves.toMatchObject({ width: 100 });
  });
});
