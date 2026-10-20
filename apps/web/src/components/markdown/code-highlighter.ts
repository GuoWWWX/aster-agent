import hljs from "highlight.js/lib/common";
import powershell from "highlight.js/lib/languages/powershell";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { mermaidLanguage } from "../editor/cm/mermaid-language.js";

const mermaidHighlighter = tagHighlighter([
  { tag: tags.keyword, class: "hljs-keyword" }, { tag: tags.string, class: "hljs-string" },
  { tag: tags.comment, class: "hljs-comment" }, { tag: tags.operator, class: "hljs-operator" },
  { tag: tags.number, class: "hljs-number" }, { tag: tags.typeName, class: "hljs-type" },
]);

hljs.registerLanguage("powershell", powershell);
hljs.registerAliases(["ps", "ps1", "pwsh"], { languageName: "powershell" });

// Bound synchronous work while streaming. Settled large blocks use a virtual
// editor; exceeding that editor's DOM threshold must not erase existing color.
const MAX_SYNCHRONOUS_HIGHLIGHT_CHARS = 64_000;

const languageAliases: Record<string, string> = {
  "c#": "csharp",
  "c++": "cpp",
  cjs: "javascript",
  htm: "xml",
  html: "xml",
  jsx: "javascript",
  md: "markdown",
  mjs: "javascript",
  plaintext: "",
  shell: "bash",
  sh: "bash",
  text: "",
  tsx: "typescript",
  txt: "",
  vue: "xml",
  yml: "yaml",
  zsh: "bash",
};

export function highlightCode(source: string, language: string): string {
  const normalizedLanguage = languageAliases[language.toLowerCase()] ?? language.toLowerCase();
  if (normalizedLanguage === "mermaid") {
    const prefix = source.slice(0, MAX_SYNCHRONOUS_HIGHLIGHT_CHARS);
    let output = "", offset = 0;
    highlightTree(mermaidLanguage.parser.parse(prefix), mermaidHighlighter, (from, to, classes) => {
      output += escapeHtml(prefix.slice(offset, from)) + `<span class="${classes}">${escapeHtml(prefix.slice(from, to))}</span>`;
      offset = to;
    });
    return output + escapeHtml(source.slice(offset));
  }
  if (normalizedLanguage.length === 0 || !hljs.getLanguage(normalizedLanguage)) {
    return escapeHtml(source);
  }

  try {
    const prefix = source.slice(0, MAX_SYNCHRONOUS_HIGHLIGHT_CHARS).replace(/[\uD800-\uDBFF]$/u, "");
    return hljs.highlight(prefix, { ignoreIllegals: true, language: normalizedLanguage }).value
      + escapeHtml(source.slice(prefix.length));
  } catch {
    return escapeHtml(source);
  }
}

export function isLargeCodeSource(source: string): boolean {
  if (source.length > 20_000) return true;
  let lineLength = 0;
  let lines = 1;
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      lines += 1;
      lineLength = 0;
      if (lines > 200) return true;
    } else if (++lineLength > 1_000) return true;
  }
  return false;
}

export function languageFromPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (name.toLowerCase() === "dockerfile") return "dockerfile";
  const extensionIndex = name.lastIndexOf(".");
  return extensionIndex === -1 ? "text" : name.slice(extensionIndex + 1);
}

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
