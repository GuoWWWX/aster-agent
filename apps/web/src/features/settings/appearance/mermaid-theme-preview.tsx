import { useEffect, useState, type ReactElement } from "react";
import { Moon, Sun } from "lucide-react";
import { renderMermaid } from "../../../lib/mermaid.js";
import { normalizeMermaidThemes, resolveMermaidTheme, type MermaidThemeSettings, type MermaidDiagramType } from "../../../lib/mermaid-theme-settings.js";
import { svgDataUrl } from "../../../lib/svg-image.js";
import { mermaidThemeSamples } from "./mermaid-theme-samples.js";
import { mermaidThemeLabel } from "./mermaid-theme-presets.js";

export function MermaidThemePreview({ type, dark, settings }: { type: MermaidDiagramType; dark: boolean; settings: MermaidThemeSettings }): ReactElement {
  const [result, setResult] = useState<{ key: string; image?: string; error?: string }>();
  const source = mermaidThemeSamples[type] ?? mermaidThemeSamples.flowchart!;
  const theme = resolveMermaidTheme(source, dark, settings);
  const key = `${dark}:${theme}:${source}`;
  useEffect(() => {
    let active = true;
    // Presets and overrides for other diagrams do not change this preview.
    const previewSettings = normalizeMermaidThemes({ light: theme, dark: theme });
    void renderMermaid(source, dark, previewSettings).then(({ svg }) => {
      if (active) setResult({ key, image: svgDataUrl(svg) });
    }).catch((error: unknown) => {
      if (active) setResult({ key, error: error instanceof Error ? error.message : "图表预览失败" });
    });
    return () => { active = false; };
  }, [source, dark, theme, key]);
  const current = result?.key === key ? result : undefined;
  return <figure className="m-0 min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border)] p-2">
    <figcaption className="mb-2 flex items-center gap-[5px] text-[length:var(--app-font-size-control)] font-medium">{dark ? <Moon aria-hidden="true" size={14} /> : <Sun aria-hidden="true" size={14} />}{dark ? "深色预览" : "浅色预览"}</figcaption>
    <div aria-live="polite" aria-busy={!current} className="flex h-[300px] min-w-0 items-center justify-center overflow-auto rounded-[var(--app-radius)] p-2 @min-[600px]:h-[340px]" style={{ background: dark ? "#202124" : "#ffffff", color: dark ? "#e4e4e7" : "#334155" }}>
      {current?.error ? <p role="alert" className="text-[length:var(--app-font-size-control)]">{current.error}</p> : current?.image ? <img src={current.image} alt={`${dark ? "深色" : "浅色"} Mermaid 主题预览`} className="max-h-full max-w-full object-contain" /> : <span className="text-[length:var(--app-font-size-control)]">正在渲染…</span>}
    </div>
    <p className="mt-2 truncate text-center text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">{mermaidThemeLabel(theme)}</p>
  </figure>;
}
