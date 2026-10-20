import { expect, it } from "vitest";
import { applicationSettingsSchema, DEFAULT_APPLICATION_SETTINGS } from "./application-settings.js";
import { DEFAULT_MERMAID_THEMES, mermaidThemeSettingsSchema } from "./mermaid-theme-settings.js";

it("loads existing appearance settings with default Mermaid themes", () => {
  const legacy = { ...DEFAULT_APPLICATION_SETTINGS.appearance };
  Reflect.deleteProperty(legacy, "mermaidThemes");
  expect(applicationSettingsSchema.parse({ ...DEFAULT_APPLICATION_SETTINGS, appearance: legacy }).appearance.mermaidThemes).toEqual(DEFAULT_MERMAID_THEMES);
});
it("round-trips independent modes, type overrides and named combinations", () => {
  const themes = { light: "dark", dark: "forest", diagrams: { sequence: { light: "neo-dark" } }, presets: [{ name: "工作", light: "neutral", dark: "redux-dark", diagrams: {} }] };
  const input = { ...DEFAULT_APPLICATION_SETTINGS, appearance: { ...DEFAULT_APPLICATION_SETTINGS.appearance, mermaidThemes: themes } };
  expect(applicationSettingsSchema.parse(JSON.parse(JSON.stringify(input))).appearance.mermaidThemes).toEqual(themes);
});
it("rejects invalid theme IDs, unknown diagram types and malformed presets at the settings boundary", () => {
  for (const input of [{ light: "bogus" }, { diagrams: { script: { light: "forest" } } }, { presets: [{ name: " " }] }]) expect(mermaidThemeSettingsSchema.safeParse(input).success).toBe(false);
});
