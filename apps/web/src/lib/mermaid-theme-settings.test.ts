import { describe, expect, it } from "vitest";
import { DEFAULT_MERMAID_THEMES, mermaidThemeSettingsSchema } from "@agent/protocol";
import { MERMAID_THEMES, mermaidDiagramType, normalizeMermaidThemes, resolveMermaidTheme } from "./mermaid-theme-settings.js";

describe("upstream Mermaid theme selection", () => {
  it("keeps valid entries while repairing obsolete choices and duplicate preset names", () => {
    const settings = normalizeMermaidThemes({ light: "unknown", dark: "neo-dark", diagrams: { state: { light: "forest", dark: "bad" }, unknown: { light: "forest" } }, presets: [{ name: " 工作 ", light: "dark", dark: "default" }, { name: "工作", light: "neo" }, { name: " " }] });
    expect(settings).toEqual({ light: "redux-color", dark: "neo-dark", diagrams: { state: { light: "forest" } }, presets: [{ name: "工作", light: "dark", dark: "default", diagrams: {} }] });
    expect(mermaidThemeSettingsSchema.parse(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });
  it("supports all 11 themes in either appearance and independent type overrides", () => {
    expect(MERMAID_THEMES).toHaveLength(11);
    for (const { id } of MERMAID_THEMES) {
      const settings = normalizeMermaidThemes({ light: id, dark: id, diagrams: { state: { light: "forest" } } });
      expect(resolveMermaidTheme("sequenceDiagram", false, settings)).toBe(id);
      expect(resolveMermaidTheme("sequenceDiagram", true, settings)).toBe(id);
      expect(resolveMermaidTheme("stateDiagram-v2", false, settings)).toBe("forest");
      expect(resolveMermaidTheme("stateDiagram-v2", true, settings)).toBe(id);
    }
    expect(normalizeMermaidThemes()).toEqual(DEFAULT_MERMAID_THEMES);
  });
  it.each([
    ["---\ntitle: sequenceDiagram\n---\n%% stateDiagram\nflowchart LR\nA[sequenceDiagram]-->B", "flowchart"],
    ["%%{init: {}}%%\nsequenceDiagram", "sequence"], ["classDiagram-v2", "class"],
    ["architecture-beta", "architecture"], ["C4Container", "c4"], ["sankey-beta", "sankey"],
  ])("detects the header of %s", (source, expected) => expect(mermaidDiagramType(source)).toBe(expected));
});
