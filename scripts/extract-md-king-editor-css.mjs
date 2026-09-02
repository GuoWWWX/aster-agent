import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 从 md-king 的 index.css 中机械提取 Markdown 编辑器相关规则。
 *
 * 逐字提取而非手工重写：262 条规则里任何一处意译都会造成视觉漂移。
 * 机械改写暗色选择器 `.dark ` -> `[data-theme="dark"] `，并在产物末尾
 * 让列表标记继承正文颜色；前者适配主题挂载方式，后者遵循 Aster 的文字颜色约定。
 */

const SOURCE = "D:/Code/Project/AI/md-king/src/index.css";
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = resolve(REPOSITORY_ROOT, "apps/web/src/components/editor/markdown-editor.css");

/** 选择器命中其中之一才提取。 */
const SELECTOR_PATTERN = /mk-cm-|mk-word-callout|mk-editor-medium|mk-editor-compact|mk-table-|cm-content|cm-scroller|cm-panel|cm-search/;

/**
 * 命中即整条丢弃。
 *
 * md-king 把编辑器外壳和应用外壳写在同一条选择器里（例如
 * `[data-slot="button"], .mk-app-window, .mk-editor-surface { border-radius: ... !important }`）。
 * 这类规则一旦带进来会用 !important 影响本项目全局按钮和面板，
 * 而它们本就不属于 Markdown 编辑器的视觉合同。
 */
const SHELL_SELECTOR_PATTERN = /\[data-slot=|mk-app-window|mk-sidebar-|mk-card|mk-workspace-panel|mk-glass|mk-output-strip|mk-drop-zone|mk-preview-panel|mk-preview-footer|mk-doc-preview/;

const source = readFileSync(SOURCE, "utf8");

/** 逐字符扫描做花括号配对，@layer / @media 等嵌套块递归展开。 */
function extractRules(text, depth = 0) {
  const rules = [];
  let index = 0;

  while (index < text.length) {
    const braceStart = text.indexOf("{", index);
    if (braceStart === -1) break;

    // 选择器 = 上一条规则结束到本条左括号之间的内容
    let selectorStart = index;
    const selector = text.slice(selectorStart, braceStart).trim();

    // 找到配对的右括号
    let depthCounter = 1;
    let scan = braceStart + 1;
    while (scan < text.length && depthCounter > 0) {
      if (text[scan] === "{") depthCounter += 1;
      else if (text[scan] === "}") depthCounter -= 1;
      scan += 1;
    }
    const body = text.slice(braceStart + 1, scan - 1);

    if (selector.startsWith("@layer") || selector.startsWith("@media") || selector.startsWith("@supports")) {
      // 容器块：递归进入，命中的子规则按原容器包裹输出
      const inner = extractRules(body, depth + 1);
      if (inner.length > 0) {
        rules.push(
          selector.startsWith("@layer")
            ? inner.join("\n\n")
            : `${selector} {\n${inner.map((r) => r.split("\n").map((l) => `  ${l}`).join("\n")).join("\n\n")}\n}`,
        );
      }
    } else if (selector.startsWith("@keyframes")) {
      if (SELECTOR_PATTERN.test(selector) || /mk-editor|mk-cm/.test(selector)) {
        rules.push(`${selector} {${body}}`);
      }
    } else if (SELECTOR_PATTERN.test(selector) && !SHELL_SELECTOR_PATTERN.test(selector)) {
      rules.push(`${selector} {${body}}`);
    }

    index = scan;
  }

  return rules;
}

const extracted = extractRules(source);

/** 顶层数组会把 @layer 内的多条规则合并成一个字符串，按左花括号统计真实规则数。 */
const ruleCount = (extracted.join("\n").match(/\{/g) ?? []).length;

/** 机械改写暗色选择器，并去掉 md-king 专有的字体变量回退。 */
const rewritten = extracted
  .join("\n\n")
  .replace(/\.dark /g, '[data-theme="dark"] ')
  .replace(/\.dark\./g, '[data-theme="dark"] .');

const asterOverrides = `
/* Aster 约定：列表圆点和编号跟随当前正文颜色。 */
.mk-cm-bullet,
.mk-cm-ordered-marker {
  color: currentColor !important;
}
`;

const header = `/*
 * Markdown 实时预览编辑器样式。
 *
 * 由 scripts/extract-md-king-editor-css.mjs 从 md-king 的 src/index.css 机械提取，
 * 请勿手工编辑本文件——重新同步时重跑脚本，避免逐条意译造成视觉漂移。
 *
 * 与源文件的差异：暗色选择器 \`.dark\` 改写为 \`[data-theme="dark"]\`；
 * 列表圆点和编号改为继承正文颜色。所需的 shadcn 语义变量由 markdown-token-bridge.css 提供。
 *
 * 源文件：md-king/src/index.css
 * 提取规则数：${ruleCount}
 */

@import "./markdown-token-bridge.css";

`;

writeFileSync(TARGET, header + rewritten + asterOverrides, "utf8");
console.log(`提取 ${ruleCount} 条规则 -> ${TARGET}`);
