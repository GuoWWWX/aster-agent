import { readFileSync } from "node:fs";

/**
 * 分析提取出的编辑器 CSS：多少条规则技术上必须用 CSS，多少条只是照抄。
 *
 * 判定"必须 CSS"的依据：
 * - 组合选择器（后代/相邻/子）、伪类、伪元素、属性选择器 -> Tailwind 无法或极难表达
 * - 定义 CSS 自定义属性供后代消费（级联）-> Tailwind 无对应能力
 * - @keyframes -> Tailwind 需要配置扩展
 * 其余的单一类名 + 普通声明，理论上都可以写成 Tailwind 原子类。
 */

const css = readFileSync(
  "D:/Code/Project/202608/Agent/apps/web/src/components/editor/markdown-editor.css",
  "utf8",
);

const rules = [];
let index = 0;
while (index < css.length) {
  const open = css.indexOf("{", index);
  if (open === -1) break;
  let depth = 1;
  let scan = open + 1;
  while (scan < css.length && depth > 0) {
    if (css[scan] === "{") depth += 1;
    else if (css[scan] === "}") depth -= 1;
    scan += 1;
  }
  const selector = css
    .slice(index, open)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  const body = css.slice(open + 1, scan - 1);
  if (selector.length > 0) rules.push({ selector, body });
  index = scan;
}

/**
 * 由 cm/*.ts 中模板字符串动态拼接的类名前缀。
 *
 * 形如 `mk-cm-h${level}`、`mk-cm-source-indent-${level}`、`mk-cm-callout-line--${tone}`
 * 的类名不是源码里的字面量，Tailwind JIT 无法静态扫描到，
 * 改用 Tailwind 需要 safelist 穷举所有运行时组合（6 级标题 × 6 级缩进 × 7 种 tone × 首尾/折叠状态）。
 */
const DYNAMIC_CLASS_PREFIXES = [
  "mk-cm-block-widget-spacing",
  "mk-cm-callout",
  "mk-cm-code-fence",
  "mk-cm-code-indent-",
  "mk-cm-code-line",
  "mk-cm-frontmatter",
  "mk-cm-h1",
  "mk-cm-h2",
  "mk-cm-h3",
  "mk-cm-h4",
  "mk-cm-h5",
  "mk-cm-h6",
  "mk-cm-heading",
  "mk-cm-link",
  "mk-cm-quote-line",
  "mk-cm-source-indent-",
];

function isDynamicallyComposed(selector) {
  return DYNAMIC_CLASS_PREFIXES.some((prefix) => selector.includes(prefix));
}

const buckets = {
  keyframes: [],
  complexSelector: [],
  cssVariableCascade: [],
  dynamicClassName: [],
  importantOverride: [],
  plainSingleClass: [],
};

for (const rule of rules) {
  const { selector, body } = rule;
  if (selector.startsWith("@keyframes")) {
    buckets.keyframes.push(selector);
    continue;
  }
  // 去掉逗号分组后，判断是否含有超出「单一类名」的结构
  const isComplex = selector
    .split(",")
    .some((part) => /:|\[|\s|>|\+|~/.test(part.trim().replace(/^\./, "")));
  if (isComplex) {
    buckets.complexSelector.push(selector);
  } else if (/--[\w-]+\s*:/.test(body)) {
    buckets.cssVariableCascade.push(selector);
  } else if (isDynamicallyComposed(selector)) {
    buckets.dynamicClassName.push(selector);
  } else if (/!important/.test(body)) {
    buckets.importantOverride.push(selector);
  } else {
    buckets.plainSingleClass.push(selector);
  }
}

const total = rules.length;
const mustBeCss =
  buckets.keyframes.length +
  buckets.complexSelector.length +
  buckets.cssVariableCascade.length +
  buckets.dynamicClassName.length;
const couldBeTailwind = buckets.plainSingleClass.length + buckets.importantOverride.length;

console.log(`总规则数: ${total}\n`);
console.log(`【技术上必须 CSS】 ${mustBeCss} 条 (${Math.round((mustBeCss / total) * 100)}%)`);
console.log(`  组合/伪类/属性选择器: ${buckets.complexSelector.length}`);
console.log(`  运行时动态拼接类名（JIT 扫不到）: ${buckets.dynamicClassName.length}`);
console.log(`  定义 CSS 变量供后代级联: ${buckets.cssVariableCascade.length}`);
console.log(`  @keyframes: ${buckets.keyframes.length}\n`);
console.log(
  `【可以是 Tailwind】 ${couldBeTailwind} 条 (${Math.round((couldBeTailwind / total) * 100)}%)`,
);
console.log(`  含 !important: ${buckets.importantOverride.length}`);
console.log(`  纯单类名普通声明: ${buckets.plainSingleClass.length}\n`);
console.log("剩余可转 Tailwind 的规则:");
[...buckets.plainSingleClass, ...buckets.importantOverride].forEach((s) => console.log(`  ${s}`));
