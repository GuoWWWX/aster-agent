import { DEFAULT_MERMAID_THEMES, MERMAID_THEME_IDS, MERMAID_DIAGRAM_IDS, mermaidThemeIdSchema, type MermaidThemeId, type MermaidThemeSettings } from "@agent/protocol";
export type { MermaidThemeId, MermaidThemeSettings, MermaidDiagramType } from "@agent/protocol";

export const MERMAID_THEMES = MERMAID_THEME_IDS.map(id => ({ id, label: id.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") }));
const diagramLabels = ["流程图", "状态图", "时序图", "类图", "实体关系图", "思维导图", "甘特图", "饼图", "用户旅程图", "Git 分支图", "时间线", "象限图", "XY 图", "需求图", "块图", "数据包图", "架构图", "看板", "桑基图", "雷达图", "树状图", "C4 架构图", "版本信息"];
export const MERMAID_DIAGRAM_TYPES = MERMAID_DIAGRAM_IDS.map((id, index) => ({ id, label: diagramLabels[index] ?? id }));
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};

/** Same per-entry repair as md-king: one obsolete theme must not erase valid choices. */
export function normalizeMermaidThemes(value?: unknown): MermaidThemeSettings {
  const selection = (input: unknown): Omit<MermaidThemeSettings, "presets"> => {
    const source = record(input), overrides = record(source.diagrams);
    const diagrams: MermaidThemeSettings["diagrams"] = {};
    for (const id of MERMAID_DIAGRAM_IDS) {
      const entry = record(overrides[id]);
      const pair: { light?: MermaidThemeId; dark?: MermaidThemeId } = {};
      for (const mode of ["light", "dark"] as const) {
        const theme = mermaidThemeIdSchema.safeParse(entry[mode]);
        if (theme.success) pair[mode] = theme.data;
      }
      if (Object.keys(pair).length) diagrams[id] = pair;
    }
    return { light: mermaidThemeIdSchema.safeParse(source.light).data ?? DEFAULT_MERMAID_THEMES.light,
      dark: mermaidThemeIdSchema.safeParse(source.dark).data ?? DEFAULT_MERMAID_THEMES.dark, diagrams };
  };
  const source = record(value);
  const presets: MermaidThemeSettings["presets"] = [];
  for (const entry of Array.isArray(source.presets) ? source.presets : []) {
    const item = record(entry), name = typeof item.name === "string" ? item.name.trim().slice(0, 40) : "";
    if (name && !presets.some(preset => preset.name === name)) presets.push({ name, ...selection(item) });
  }
  return { ...selection(source), presets };
}

/** Only the header selects a diagram; labels and comments never override it. */
export function mermaidDiagramType(source: string): string {
  const header = source.trim().replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(/%%\{[\s\S]*?\}%%/g, "").replace(/^\s*%%[^\n]*(?:\n|$)/gm, "").trim();
  const name = header.match(/^[\w-]+/)?.[0] ?? "";
  if (/^(graph|flowchart)(-elk)?$/.test(name)) return "flowchart";
  if (/^stateDiagram(-v2)?$/.test(name)) return "state";
  if (/^classDiagram(-v2)?$/.test(name)) return "class";
  if (name === "sequenceDiagram") return "sequence";
  if (name === "erDiagram") return "er";
  if (name === "quadrantChart") return "quadrant";
  if (/^requirement(Diagram)?$/.test(name)) return "requirement";
  if (/^C4(Context|Container|Component|Dynamic|Deployment)$/.test(name)) return "c4";
  return name.replace(/-beta$/, "");
}

export function resolveMermaidTheme(source: string, dark: boolean, settings: MermaidThemeSettings = DEFAULT_MERMAID_THEMES): MermaidThemeId {
  const mode = dark ? "dark" : "light";
  const type = MERMAID_DIAGRAM_IDS.find(id => id === mermaidDiagramType(source));
  return (type === undefined ? undefined : settings.diagrams[type]?.[mode]) ?? settings[mode];
}
