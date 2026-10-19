import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { compileScript, compileStyle, compileTemplate, parse } from "@vue/compiler-sfc";
import { z } from "zod";
import { unpackedExecutablePath } from "../tools/bundled-executable-path.js";
import { ToolArgumentsError } from "../model/tool-arguments.js";
import type { CodePreviewLanguage } from "@agent/protocol";

const requirePreview = createRequire(typeof __filename === "string" ? __filename : import.meta.url);
const runtimeImports = new Set(["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom/client", "vue"]);
function invalidSource(message: string): ToolArgumentsError {
  return new ToolArgumentsError(`预览源码无法编译：${message.slice(0, 800)}`, [{ code: "preview_compile", path: ["code"], message: message.slice(0, 800) }]);
}

/** Only self-contained source is compiled. No project reads, installs, remote imports or code execution on Main. */
export async function compilePreviewSource(source: string, language: CodePreviewLanguage): Promise<string> {
  if (language === "html") return source;
  let component = source;
  let style = "";
  if (language === "vue") {
    try {
      const id = createHash("sha256").update(source).digest("hex").slice(0, 12);
      const { descriptor, errors } = parse(source, { filename: "Preview.vue" });
      if (errors.length > 0) throw new Error(`Vue 预览解析失败：${String(errors[0])}`);
      if ([descriptor.script, descriptor.scriptSetup, descriptor.template, ...descriptor.styles].some(block => block?.src)) {
        throw new Error("Vue 预览只支持自包含组件，不支持 src 引用外部文件。");
      }
      if (descriptor.customBlocks.length > 0 || descriptor.styles.some(block => block.module || (block.lang && block.lang !== "css")) || (descriptor.template?.lang && descriptor.template.lang !== "html")) {
        throw new Error("Vue 预览支持 template、script 和 CSS style；其他预处理器需要项目构建环境。");
      }
      component = descriptor.script || descriptor.scriptSetup
        ? compileScript(descriptor, { id, genDefaultAs: "__component", inlineTemplate: true }).content
        : "const __component = {};";
      if (!descriptor.scriptSetup && descriptor.template) {
        const template = compileTemplate({ source: descriptor.template.content, filename: "Preview.vue", id, scoped: descriptor.styles.some(block => block.scoped) });
        if (template.errors.length > 0) throw new Error(`Vue 模板编译失败：${String(template.errors[0])}`);
        component += `\n${template.code}\n__component.render = render;`;
      }
      component += `\n__component.__scopeId = "data-v-${id}";\nexport default __component;`;
      for (const block of descriptor.styles) {
        const compiled = compileStyle({ source: block.content, filename: "Preview.vue", id: `data-v-${id}`, scoped: block.scoped === true });
        if (compiled.errors.length > 0) throw new Error(`Vue 样式编译失败：${String(compiled.errors[0])}`);
        style += compiled.code;
      }
    } catch (error) { throw invalidSource(error instanceof Error ? error.message : String(error)); }
  } else if (source.trimStart().startsWith("<")) {
    component = `export default function Preview(){return (${source});}`;
  }
  const entry = language === "react"
    ? 'import {createElement} from "react";import {createRoot} from "react-dom/client";import Component from "aster:component";createRoot(document.getElementById("root"),{onUncaughtError:window.__asterPreviewError}).render(createElement(Component));'
    : 'import {createApp} from "vue";import Component from "aster:component";const app=createApp(Component);app.config.errorHandler=window.__asterPreviewError;app.mount("#root");';
  const compiler = requirePreview(unpackedExecutablePath(requirePreview.resolve("esbuild"))) as typeof import("esbuild");
  const result = await compiler.build({
    stdin: { contents: entry, sourcefile: "preview-entry.js" }, bundle: true, write: false, platform: "browser", format: "iife",
    minify: true, charset: "utf8", logLevel: "silent", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', __VUE_OPTIONS_API__: "true", __VUE_PROD_DEVTOOLS__: "false", __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false" },
    plugins: [{ name: "isolated-preview-imports", setup(builder) {
      builder.onResolve({ filter: /^aster:component$/ }, () => ({ path: "component", namespace: "preview-component" }));
      builder.onLoad({ filter: /.*/, namespace: "preview-component" }, () => ({ contents: component, loader: "tsx" }));
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.namespace === "file") return;
        if (!runtimeImports.has(args.path)) return { errors: [{ text: `预览仅支持 React／Vue 内置运行库，不能 import ${args.path}。` }] };
        return { path: unpackedExecutablePath(requirePreview.resolve(args.path === "vue" ? "vue/dist/vue.runtime.esm-bundler.js" : args.path)) };
      });
    } }],
  }).catch((error: unknown) => {
    const failure = z.object({ errors: z.array(z.object({ text: z.string(), location: z.object({ line: z.number(), column: z.number(), lineText: z.string() }).nullable().optional() })) }).safeParse(error);
    if (!failure.success) throw error;
    throw invalidSource(failure.data.errors.slice(0, 3).map(issue => `${issue.location ? `line ${issue.location.line}:${issue.location.column + 1}: ` : ""}${issue.text}${issue.location ? `\n${issue.location.lineText.slice(0, 180)}` : ""}`).join("\n"));
  });
  const javascript = result.outputFiles[0]?.text;
  if (javascript === undefined) throw new Error("代码预览未生成可运行内容。");
  const errorReporter = 'window.__asterPreviewError=error=>{const node=document.createElement("pre");node.setAttribute("role","alert");node.textContent="预览运行失败："+String(error?.message??error);node.style.cssText="white-space:pre-wrap;color:#b91c1c;padding:16px";document.body.append(node)};window.addEventListener("error",event=>window.__asterPreviewError(event.error??event.message));window.addEventListener("unhandledrejection",event=>window.__asterPreviewError(event.reason));';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style.replace(/<\/style/giu, "<\\/style")}</style></head><body><div id="root"></div><script>${errorReporter}${javascript.replace(/<\/script/giu, "<\\/script")}</script></body></html>`;
}
