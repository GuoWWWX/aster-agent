import hljs from "highlight.js/lib/common";
import powershell from "highlight.js/lib/languages/powershell";

hljs.registerLanguage("powershell", powershell);
hljs.registerAliases(["ps", "ps1", "pwsh"], { languageName: "powershell" });

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
  if (normalizedLanguage.length === 0 || !hljs.getLanguage(normalizedLanguage)) {
    return escapeHtml(source);
  }

  try {
    return hljs.highlight(source, { ignoreIllegals: true, language: normalizedLanguage }).value;
  } catch {
    return escapeHtml(source);
  }
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
