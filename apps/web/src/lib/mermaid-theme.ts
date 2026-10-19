/** Shared diagram configuration; rendering, queues and caches belong to mermaid.ts. */
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
/* 状态图 (State Diagram) 连线与箭头统一使用琥珀主橙色 #f59e0b */
.transition,
path.transition,
.edgePaths .transition,
.statediagram-state line,
g.stateGroup line {
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
  fill: none !important;
}
defs [id*="barbEnd"],
[id*="barbEnd"] path,
marker[id*="barbEnd"] path,
[id$="-barbEnd"],
[id$="-barbEnd"] path {
  fill: #f59e0b !important;
  stroke: #f59e0b !important;
}
.node circle.state-start,
circle.state-start,
.node .fork-join,
rect.fork-join {
  fill: #f59e0b !important;
  stroke: #f59e0b !important;
}
`;

export function mermaidConfig(theme: "default" | "dark") {
  const isDark = theme === "dark";
  return {
    startOnLoad: false,
    theme: "default" as const,
    securityLevel: "strict" as const,
    htmlLabels: true,
    fontFamily: MERMAID_FONT_FAMILY,
    fontSize: MERMAID_FONT_SIZE,
    markdownAutoWrap: true,
    themeVariables: {
      fontSize: `${MERMAID_FONT_SIZE}px`,
      fontFamily: MERMAID_FONT_FAMILY,
      // 深浅色模式使用完全相同的核心主橙色 #f59e0b
      lineColor: "#f59e0b",
      primaryBorderColor: "#f59e0b",
      nodeBorder: "#f59e0b",
      actorBorder: "#f59e0b",
      actorLineColor: "#f59e0b",
      signalColor: "#f59e0b",
      labelBoxBorderColor: "#f59e0b",
      loopLineColor: "#f59e0b",
      noteBorderColor: "#f59e0b",
      sequenceNumberColor: isDark ? "#fef3c7" : "#1c1917",
      // 方块填充：浅色模式 #fef3c7（正宗浅橙金色），深色模式 #382613（深黑棕夜光底）
      primaryColor: isDark ? "#382613" : "#fef3c7",
      actorBkg: isDark ? "#382613" : "#fef3c7",
      labelBoxBkgColor: isDark ? "#382613" : "#fef3c7",
      mainBkg: isDark ? "#382613" : "#fef3c7",
      // 容器背景与便签背景
      secondaryColor: isDark ? "#292015" : "#fffbeb",
      tertiaryColor: isDark ? "#261e14" : "#fffbeb",
      noteBkgColor: isDark ? "#292015" : "#fffbeb",
      // 文本颜色
      primaryTextColor: isDark ? "#fef3c7" : "#1c1917",
      actorTextColor: isDark ? "#fef3c7" : "#1c1917",
      signalTextColor: isDark ? "#fef3c7" : "#1c1917",
      labelTextColor: isDark ? "#fef3c7" : "#78350f",
      loopTextColor: isDark ? "#fef3c7" : "#78350f",
      noteTextColor: isDark ? "#fef3c7" : "#1c1917",
    },
    themeCSS: MERMAID_THEME_CSS + (isDark ? `
/* ====== 深色模式：暖金/琥珀夜光体系 ====== */
/* 流程图子图（Cluster）容器与标题 */
.cluster rect {
  fill: #261e14 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
  rx: 6px !important;
  ry: 6px !important;
}
.cluster-label text, .cluster-label span, .cluster-label .nodeLabel {
  fill: #fde68a !important;
  color: #fde68a !important;
  font-weight: 600 !important;
}

/* 流程图节点小方块（矩形、多边形/菱形、圆形等） */
.node[id*="-flowchart-"] rect,
.node[id*="-flowchart-"] polygon,
.node[id*="-flowchart-"] circle,
.node[id*="-flowchart-"] ellipse,
.node[id*="-flowchart-"] path {
  fill: #382613 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.node .nodeLabel,
.node text,
.node span {
  fill: #fde68a !important;
  color: #fde68a !important;
}

/* 连线与连线标签 */
.relation, .edgePath .path {
  stroke: #f59e0b !important;
}
[id$="-arrowhead"] path:not([fill]):not([style*="fill"]),
[id$="-crosshead"] path:not([fill]):not([style*="fill"]),
marker path:not([fill]):not([style*="fill"]) {
  fill: #f59e0b !important;
  stroke: #f59e0b !important;
}
.edgeLabel text, .edgeLabel span {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
}

/* 时序图 (Sequence Diagram) */
rect.actor, rect[class*="actor"], .actor rect {
  fill: #382613 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
text.actor, text[class*="actor"], .actor text, .actor tspan {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
  stroke: none !important;
}
.actor-man line, line.actor-man {
  stroke: #f59e0b !important;
  stroke-width: 2px !important;
}
.actor-man circle, circle.actor-man {
  stroke: #f59e0b !important;
  stroke-width: 2px !important;
  fill: #382613 !important;
}
.actor-line {
  stroke: #f59e0b !important;
}
.messageText {
  fill: #fef3c7 !important;
}
.messageLine0, .messageLine1 {
  stroke: #f59e0b !important;
}
.note {
  fill: #292015 !important;
  stroke: #f59e0b !important;
}
.noteText, .noteText tspan {
  fill: #fef3c7 !important;
}
/* 时序图 alt/loop 条件框体与其文字 */
.labelBox {
  fill: #382613 !important;
  stroke: #f59e0b !important;
}
.labelText, .loopText, .loopText tspan {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
  font-weight: 600 !important;
}
.sectionTitle, .sectionTitle text {
  fill: #fde68a !important;
  color: #fde68a !important;
  font-weight: 600 !important;
}
.loopLine {
  stroke: #f59e0b !important;
}
/* 时序图 autonumber 序号圆点与文字：紧凑精致，文字清晰不模糊，完美垂直居中 */
[id$="-sequencenumber"] circle, marker[id*="sequencenumber"] circle {
  r: 7.5px !important;
  fill: #382613 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.2px !important;
}
.sequenceNumber {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
  font-weight: 700 !important;
  font-size: 11px !important;
  dominant-baseline: central !important;
  text-anchor: middle !important;
}

/* 状态图 (State Diagram) */
.statediagram-state rect {
  fill: #382613 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.statediagram-cluster rect,
.statediagram-cluster rect.outer {
  fill: #261e14 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.statediagram-cluster .inner {
  fill: #1c150e !important;
}
.node circle.state-end {
  fill: #261e14 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.end-state-inner {
  fill: #f59e0b !important;
  stroke: none !important;
}
.state-title,
.transitionLabel,
.state-note,
.statediagram-state text,
.statediagram-note text,
.state-title text,
.stateLabel text,
.statediagram .edgeLabel {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
}
.statediagram-note rect {
  fill: #292015 !important;
  stroke: #f59e0b !important;
}

/* 类图与 ER 图 */
.classTitle text { fill: #fef3c7 !important; }
.relationLabel { fill: #fef3c7 !important; }
.node[id*="classId-"] .outer-path path:first-child,
g.classGroup rect,
.node[id*="classId-"] rect {
  fill: #382613 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
g.classGroup line, .node[id*="classId-"] line, .divider {
  stroke: #f59e0b !important;
  stroke-width: 1px !important;
}
g.classGroup text, g.classGroup span, .node[id*="classId-"] text, .node[id*="classId-"] span {
  fill: #fef3c7 !important;
  color: #fef3c7 !important;
}
.er.entityBox { fill: #382613 !important; stroke: #f59e0b !important; }
.er.attributeBoxOdd { fill: #261e14 !important; }
.er.attributeBoxEven { fill: #382613 !important; }
.er.entityBox text, .er.attributeBoxOdd text, .er.attributeBoxEven text, .er.relationshipLabel text {
  fill: #fef3c7 !important;
}
.er.relationshipLine { stroke: #f59e0b !important; }
` : `
/* ====== 浅色模式：暖金/琥珀日间体系 ====== */
/* 流程图子图（Cluster）容器与标题 */
.cluster rect {
  fill: #fffbeb !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
  rx: 6px !important;
  ry: 6px !important;
}
.cluster-label text, .cluster-label span, .cluster-label .nodeLabel {
  fill: #78350f !important;
  color: #78350f !important;
  font-weight: 600 !important;
}

/* 流程图节点小方块（矩形、多边形/菱形、圆形等）：边框纯正橙色，中间浅一点的橙色 */
.node[id*="-flowchart-"] rect,
.node[id*="-flowchart-"] polygon,
.node[id*="-flowchart-"] circle,
.node[id*="-flowchart-"] ellipse,
.node[id*="-flowchart-"] path {
  fill: #fef3c7 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.node .nodeLabel,
.node text,
.node span {
  fill: #ea580c !important;
  color: #ea580c !important;
}

/* 连线与连线标签 */
.relation, .edgePath .path {
  stroke: #f59e0b !important;
}
[id$="-arrowhead"] path:not([fill]):not([style*="fill"]),
[id$="-crosshead"] path:not([fill]):not([style*="fill"]),
marker path:not([fill]):not([style*="fill"]) {
  fill: #f59e0b !important;
  stroke: #f59e0b !important;
}
.edgeLabel text, .edgeLabel span {
  fill: #1c1917 !important;
  color: #1c1917 !important;
}

/* 时序图 (Sequence Diagram)：方块边框纯正橙色，中间浅一点的橙色 */
rect.actor, rect[class*="actor"], .actor rect {
  fill: #fef3c7 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
text.actor, text[class*="actor"], .actor text, .actor tspan {
  fill: #1c1917 !important;
  color: #1c1917 !important;
  stroke: none !important;
}
.actor-man line, line.actor-man {
  stroke: #f59e0b !important;
  stroke-width: 2px !important;
}
.actor-man circle, circle.actor-man {
  stroke: #f59e0b !important;
  stroke-width: 2px !important;
  fill: #fef3c7 !important;
}
.actor-line {
  stroke: #f59e0b !important;
}
.messageText {
  fill: #1c1917 !important;
}
.messageLine0, .messageLine1 {
  stroke: #f59e0b !important;
}
.note {
  fill: #fffbeb !important;
  stroke: #f59e0b !important;
}
.noteText, .noteText tspan {
  fill: #1c1917 !important;
}
/* 时序图 alt/loop 条件框体与其文字 */
.labelBox {
  fill: #fef3c7 !important;
  stroke: #f59e0b !important;
}
.labelText, .loopText, .loopText tspan {
  fill: #78350f !important;
  color: #78350f !important;
  font-weight: 600 !important;
}
.sectionTitle, .sectionTitle text {
  fill: #78350f !important;
  color: #78350f !important;
  font-weight: 600 !important;
}
.loopLine {
  stroke: #f59e0b !important;
}
/* 时序图 autonumber 序号圆点与文字：紧凑精致，文字清晰不模糊，完美垂直居中 */
[id$="-sequencenumber"] circle, marker[id*="sequencenumber"] circle {
  r: 7.5px !important;
  fill: #fef3c7 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.2px !important;
}
.sequenceNumber {
  fill: #1c1917 !important;
  color: #1c1917 !important;
  font-weight: 700 !important;
  font-size: 11px !important;
  dominant-baseline: central !important;
  text-anchor: middle !important;
}

/* 状态图 (State Diagram) */
.statediagram-state rect {
  fill: #fef3c7 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.statediagram-cluster rect,
.statediagram-cluster rect.outer {
  fill: #fffbeb !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.statediagram-cluster .inner {
  fill: #fef3c7 !important;
}
.node circle.state-end {
  fill: #fffbeb !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
.end-state-inner {
  fill: #f59e0b !important;
  stroke: none !important;
}
.state-title,
.transitionLabel,
.state-note,
.statediagram-state text,
.statediagram-note text,
.state-title text,
.stateLabel text,
.statediagram .edgeLabel {
  fill: #1c1917 !important;
  color: #1c1917 !important;
}
.statediagram-note rect {
  fill: #fffbeb !important;
  stroke: #f59e0b !important;
}

/* 类图与 ER 图 */
.classTitle text { fill: #1c1917 !important; }
.relationLabel { fill: #1c1917 !important; }
.node[id*="classId-"] .outer-path path:first-child,
g.classGroup rect,
.node[id*="classId-"] rect {
  fill: #fef3c7 !important;
  stroke: #f59e0b !important;
  stroke-width: 1.5px !important;
}
g.classGroup line, .node[id*="classId-"] line, .divider {
  stroke: #f59e0b !important;
  stroke-width: 1px !important;
}
g.classGroup text, g.classGroup span, .node[id*="classId-"] text, .node[id*="classId-"] span {
  fill: #1c1917 !important;
  color: #1c1917 !important;
}
.er.entityBox { fill: #fef3c7 !important; stroke: #f59e0b !important; }
.er.attributeBoxOdd { fill: #fffbeb !important; }
.er.attributeBoxEven { fill: #fef3c7 !important; }
.er.entityBox text, .er.attributeBoxOdd text, .er.attributeBoxEven text, .er.relationshipLabel text {
  fill: #1c1917 !important;
}
.er.relationshipLine { stroke: #f59e0b !important; }
`),
    flowchart: {
      htmlLabels: true,
      useMaxWidth: true,
      wrappingWidth: MERMAID_LABEL_WRAP_WIDTH,
      nodeSpacing: 50,
      rankSpacing: 60,
      padding: 24,
      subGraphTitleMargin: { top: 16, bottom: 32 },
      curve: "basis" as const,
    },
  };
}
