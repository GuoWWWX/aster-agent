import { z } from "zod";

export const MERMAID_THEME_IDS = ["redux-color", "redux-dark-color", "redux", "redux-dark", "neo", "neo-dark", "default", "dark", "forest", "neutral", "base"] as const;
export const MERMAID_DIAGRAM_IDS = ["flowchart", "state", "sequence", "class", "er", "mindmap", "gantt", "pie", "journey", "gitGraph", "timeline", "quadrant", "xychart", "requirement", "block", "packet", "architecture", "kanban", "sankey", "radar", "treemap", "c4", "info"] as const;
export const mermaidThemeIdSchema = z.enum(MERMAID_THEME_IDS);
const themeOverridesSchema = z.partialRecord(z.enum(MERMAID_DIAGRAM_IDS), z.object({ light: mermaidThemeIdSchema.optional(), dark: mermaidThemeIdSchema.optional() }).strict());
const selectionShape = {
  light: mermaidThemeIdSchema.default("redux-color"),
  dark: mermaidThemeIdSchema.default("redux-dark-color"),
  diagrams: themeOverridesSchema.default({}),
};
export const mermaidThemePresetSchema = z.object({ name: z.string().trim().min(1).max(40), ...selectionShape }).strict();
export const mermaidThemeSettingsSchema = z.object({ ...selectionShape, presets: z.array(mermaidThemePresetSchema).default([]) }).strict();
export type MermaidThemeId = z.infer<typeof mermaidThemeIdSchema>;
export type MermaidDiagramType = typeof MERMAID_DIAGRAM_IDS[number];
export type MermaidThemePreset = z.infer<typeof mermaidThemePresetSchema>;
export type MermaidThemeSettings = z.infer<typeof mermaidThemeSettingsSchema>;
export const DEFAULT_MERMAID_THEMES: MermaidThemeSettings = mermaidThemeSettingsSchema.parse({});
