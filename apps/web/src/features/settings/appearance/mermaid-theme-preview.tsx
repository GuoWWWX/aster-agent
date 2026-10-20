import { useEffect, useState, type ReactElement } from "react";
import { renderMermaid } from "../../../lib/mermaid.js";
import { resolveMermaidTheme, type MermaidThemeSettings, type MermaidDiagramType } from "../../../lib/mermaid-theme-settings.js";
import { svgDataUrl } from "../../../lib/svg-image.js";
import { mermaidThemeSamples } from "./mermaid-theme-samples.js";

export function MermaidThemePreview({ type, dark, settings }: { type: MermaidDiagramType; dark: boolean; settings: MermaidThemeSettings }): ReactElement {
  const [result, setResult] = useState<{ image?: string; error?: string }>({});
  const source = mermaidThemeSamples[type] ?? mermaidThemeSamples.flowchart!;
  const theme = resolveMermaidTheme(source, dark, settings);
  useEffect(() => {
    let active = true;
    void renderMermaid(source, dark, settings).then(({ svg }) => {
      if (active) setResult({ image: svgDataUrl(svg) });
    }).catch((error: unknown) => {
      if (active) setResult({ error: error instanceof Error ? error.message : "图表预览失败" });
    });
    return () => { active = false; };
  }, [source, dark, settings]);
  return <figure className="m-0 min-w-0">
    <figcaption className="mb-[5px] text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">{dark ? "深色" : "浅色"} · {theme}</figcaption>
    <div aria-live="polite" className="flex h-64 min-w-0 items-center justify-center overflow-auto rounded-[var(--app-radius)] border border-[var(--app-border)] p-2" style={{ background: dark ? "#202124" : "#ffffff", color: dark ? "#e4e4e7" : "#334155" }}>
      {result.error ? <p role="alert" className="text-[length:var(--app-font-size-control)]">{result.error}</p> : result.image ? <img src={result.image} alt={`${dark ? "深色" : "浅色"} Mermaid 主题预览`} className="max-h-full max-w-full object-contain" /> : <span>正在渲染…</span>}
    </div>
  </figure>;
}
