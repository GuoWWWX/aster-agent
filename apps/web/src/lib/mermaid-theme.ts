import type { MermaidConfig } from "mermaid";
import type { MermaidThemeId } from "@agent/protocol";

// Shared by conversation diagrams and Markdown documents.
const MERMAID_FONT_FAMILY = "Microsoft YaHei, Segoe UI Emoji, sans-serif";
const MERMAID_FONT_SIZE = 14;
const MERMAID_LABEL_WRAP_WIDTH = 240;
const MERMAID_THEME_CSS = `
.nodeLabel {
  display: inline-block;
  max-width: ${MERMAID_LABEL_WRAP_WIDTH}px;
  white-space: normal !important;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.25;
  text-align: center;
}
.nodeLabel p { margin: 0; }
.cluster-label { padding-bottom: 8px; }
.cluster-label .nodeLabel { max-width: 480px; font-weight: 600; line-height: 1.35; }
/* 类图方法与属性列表：单行完整舒展展现，不限宽度、不折行，左对齐展示代码签名 */
g.classGroup .nodeLabel,
.node[id*="classId-"] .nodeLabel,
g.classGroup div,
.node[id*="classId-"] div,
g.classGroup span,
.node[id*="classId-"] span,
g.classGroup p,
.node[id*="classId-"] p {
  max-width: none !important;
  white-space: nowrap !important;
  text-align: left !important;
  overflow-wrap: normal !important;
  word-break: normal !important;
}
/* 类名标题保持居中加粗 */
g.classGroup .classTitle .nodeLabel,
.node[id*="classId-"] .classTitle .nodeLabel,
.classTitle,
.classTitleText {
  text-align: center !important;
}
/* 连线标签只显示文字，不绘制 Mermaid 默认的背景块。 */
.edgeLabel,
.edgeLabel *,
.edgeLabel p,
.edgeLabel span,
.edgeLabel foreignObject,
.edgeLabel foreignObject > div { background: transparent !important; background-color: transparent !important; }
.edgeLabel rect { fill: transparent !important; stroke: none !important; }
.edgeLabel, .edgeLabel * { text-shadow: none !important; }
.edgeLabel text, .edgeLabel tspan { paint-order: normal; stroke: none !important; }
/* 连线标签文字长时自动折行，避免被 foreignObject 默认单行截断 */
.edgeLabel,
.labelBkg,
.edgeLabel p,
.edgeLabel span,
.edgeLabel div,
.edgeLabel foreignObject > div {
  white-space: normal !important;
  overflow-wrap: anywhere !important;
  word-break: break-word !important;
  line-height: 1.35 !important;
  text-align: center !important;
}
.edgeLabel foreignObject {
  overflow: visible !important;
}
`;

export function mermaidConfig(theme: "default" | "dark", selectedTheme?: MermaidThemeId): MermaidConfig {
  const isDark = theme === "dark";
  return {
    startOnLoad: false,
    theme: selectedTheme ?? (isDark ? "redux-dark-color" : "redux-color"),
    look: "neo",
    securityLevel: "strict",
    htmlLabels: true,
    fontFamily: MERMAID_FONT_FAMILY,
    fontSize: MERMAID_FONT_SIZE,
    markdownAutoWrap: true,
    themeVariables: {
      darkMode: isDark,
      background: isDark ? "#202124" : "#ffffff",
      fontSize: `${MERMAID_FONT_SIZE}px`,
      fontFamily: MERMAID_FONT_FAMILY,
    },
    themeCSS: MERMAID_THEME_CSS,
    flowchart: {
      htmlLabels: true,
      useMaxWidth: true,
      wrappingWidth: MERMAID_LABEL_WRAP_WIDTH,
      nodeSpacing: 50,
      rankSpacing: 60,
      padding: 24,
      subGraphTitleMargin: { top: 16, bottom: 32 },
      curve: "basis",
    },
  };
}
