import defaultFile from "@iconify-icons/vscode-icons/default-file";
import fileTypeCss from "@iconify-icons/vscode-icons/file-type-css";
import fileTypeDocker from "@iconify-icons/vscode-icons/file-type-docker";
import fileTypeHtml from "@iconify-icons/vscode-icons/file-type-html";
import fileTypeImage from "@iconify-icons/vscode-icons/file-type-image";
import fileTypeJs from "@iconify-icons/vscode-icons/file-type-js";
import fileTypeJson from "@iconify-icons/vscode-icons/file-type-json";
import fileTypeMarkdown from "@iconify-icons/vscode-icons/file-type-markdown";
import fileTypePdf from "@iconify-icons/vscode-icons/file-type-pdf2";
import fileTypePython from "@iconify-icons/vscode-icons/file-type-python";
import fileTypeReactJs from "@iconify-icons/vscode-icons/file-type-reactjs";
import fileTypeReactTs from "@iconify-icons/vscode-icons/file-type-reactts";
import fileTypeShell from "@iconify-icons/vscode-icons/file-type-shell";
import fileTypeSql from "@iconify-icons/vscode-icons/file-type-sql";
import fileTypeTypescript from "@iconify-icons/vscode-icons/file-type-typescript";
import fileTypeVue from "@iconify-icons/vscode-icons/file-type-vue";
import fileTypeXml from "@iconify-icons/vscode-icons/file-type-xml";
import fileTypeYaml from "@iconify-icons/vscode-icons/file-type-yaml";

import type { JavaDeclarationKind } from "@agent/protocol";

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

function officeFileIcon({
  accent,
  detail,
  glyph,
  variant,
}: {
  accent: string;
  detail: string;
  glyph: "P" | "W" | "X";
  variant: "outline" | "solid";
}) {
  const badgeFill = variant === "solid" ? accent : "#ffffff";
  const glyphFill = variant === "solid" ? "#ffffff" : accent;
  const glyphPath = {
    P: "M6.7 13.8h4.4c2.4 0 3.8 1.3 3.8 3.3s-1.4 3.3-3.8 3.3H9.2v2.1H6.7Zm2.5 2v2.6h1.7c1 0 1.6-.4 1.6-1.3s-.6-1.3-1.6-1.3Z",
    W: "M5.8 13.8h2.5l1 5.1 1.5-5.1h2l1.5 5.1 1-5.1h2.5l-2 8.7h-2.6l-1.4-4.7-1.4 4.7H7.8Z",
    X: "m6.2 13.8 3.1 4.2-3.3 4.5h2.9l1.8-2.6 1.8 2.6h2.9L12.1 18l3.1-4.2h-2.9l-1.6 2.4-1.6-2.4Z",
  }[glyph];

  return {
    width: 32,
    height: 32,
    body: `<g data-office-variant="${variant}"><path fill="#fff" stroke="#94a3b8" stroke-linejoin="round" stroke-width="1.4" d="M9.5 2.5h12l7 7v20h-19Z"/><path fill="#e2e8f0" stroke="#94a3b8" stroke-linejoin="round" stroke-width="1.4" d="M21.5 2.5v7h7"/><path fill="none" stroke="${detail}" stroke-linecap="round" stroke-width="1.5" d="M21.5 14.5h4.5m-4.5 4h4.5m-4.5 4h4.5"/><rect width="17" height="14" x="2.5" y="10.5" fill="${badgeFill}" stroke="${accent}" stroke-width="1.7" rx="2.2"/><path fill="${glyphFill}" d="${glyphPath}"/></g>`,
  };
}

const fileTypeWord = officeFileIcon({
  accent: "#2563eb",
  detail: "#bfdbfe",
  glyph: "W",
  variant: "solid",
});
const fileTypeWordLegacy = officeFileIcon({
  accent: "#2563eb",
  detail: "#bfdbfe",
  glyph: "W",
  variant: "outline",
});
const fileTypeExcel = officeFileIcon({
  accent: "#16a34a",
  detail: "#bbf7d0",
  glyph: "X",
  variant: "solid",
});
const fileTypeExcelLegacy = officeFileIcon({
  accent: "#16a34a",
  detail: "#bbf7d0",
  glyph: "X",
  variant: "outline",
});
const fileTypePowerpoint = officeFileIcon({
  accent: "#e34f26",
  detail: "#fed7aa",
  glyph: "P",
  variant: "solid",
});
const fileTypePowerpointLegacy = officeFileIcon({
  accent: "#e34f26",
  detail: "#fed7aa",
  glyph: "P",
  variant: "outline",
});

const RECOGNIZED_FILE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  "bash", "cjs", "class", "css", "csv", "doc", "docm", "docx", "dot", "dotm", "dotx",
  "htm", "html", "java", "js", "json", "jsonc", "jsx", "less", "md", "mdx", "mjs",
  "mts", "pdf", "pot", "potm", "potx", "pps", "ppsm", "ppsx", "ppt", "pptm", "pptx",
  "ps1", "py", "rtf", "sass", "scss", "sh", "sql", "ts", "tsv", "tsx", "vue", "xls", "xlsb",
  "xlsm", "xlsx", "xml", "yaml", "yml", "zsh",
]);

function normalizedFileName(path: string): string {
  const cleanPath = path.split(/[?#]/u, 1)[0] ?? path;
  return cleanPath.replaceAll("\\", "/").split("/").at(-1)?.toLocaleLowerCase("en-US") ?? "";
}

function iconForPath(path: string) {
  const name = normalizedFileName(path);
  const extension = name.split(".").at(-1) ?? "";

  if (IMAGE_EXTENSIONS.has(extension)) return fileTypeImage;
  if (name === "dockerfile" || extension === "dockerfile") return fileTypeDocker;

  switch (extension) {
    case "md":
    case "mdx":
      return fileTypeMarkdown;
    case "json":
    case "jsonc":
      return fileTypeJson;
    case "js":
    case "mjs":
    case "cjs":
      return fileTypeJs;
    case "jsx":
      return fileTypeReactJs;
    case "ts":
    case "mts":
    case "cts":
      return fileTypeTypescript;
    case "tsx":
      return fileTypeReactTs;
    case "css":
    case "scss":
    case "sass":
    case "less":
      return fileTypeCss;
    case "html":
    case "htm":
      return fileTypeHtml;
    case "vue":
      return fileTypeVue;
    case "yaml":
    case "yml":
      return fileTypeYaml;
    case "xml":
      return fileTypeXml;
    case "py":
      return fileTypePython;
    case "sh":
    case "bash":
    case "zsh":
    case "ps1":
      return fileTypeShell;
    case "sql":
      return fileTypeSql;
    case "pdf":
      return fileTypePdf;
    case "docm":
    case "docx":
    case "dotm":
    case "dotx":
      return fileTypeWord;
    case "doc":
    case "dot":
    case "rtf":
      return fileTypeWordLegacy;
    case "xlsb":
    case "xlsm":
    case "xlsx":
      return fileTypeExcel;
    case "csv":
    case "tsv":
    case "xls":
      return fileTypeExcelLegacy;
    case "potm":
    case "potx":
    case "ppsm":
    case "ppsx":
    case "pptm":
    case "pptx":
      return fileTypePowerpoint;
    case "pot":
    case "pps":
    case "ppt":
      return fileTypePowerpointLegacy;
    default:
      return defaultFile;
  }
}

function javaPresentation(javaDeclarationKind?: JavaDeclarationKind) {
  return {
    annotation: { color: "#b7791f", label: "A" },
    class: { color: "#3b82f6", label: "C" },
    enum: { color: "#c77700", label: "E" },
    interface: { color: "#3f9f58", label: "I" },
    record: { color: "#8b5cf6", label: "R" },
  }[javaDeclarationKind ?? "class"];
}

export function fileTypeIconPresentation(path: string, javaDeclarationKind?: JavaDeclarationKind) {
  const extension = normalizedFileName(path).split(".").at(-1) ?? "";
  if (extension === "java" || extension === "class") {
    const kind = extension === "class" ? "class" : javaDeclarationKind;
    return { kind: "java" as const, ...javaPresentation(kind) };
  }
  return { icon: iconForPath(path), kind: "icon" as const };
}

export function isRecognizedFileTypePath(path: string): boolean {
  const name = normalizedFileName(path);
  if (name === "dockerfile") return true;
  const extension = name.split(".").at(-1) ?? "";
  return RECOGNIZED_FILE_EXTENSIONS.has(extension);
}

export function fileTypeIconMarkup(path: string, size = 14): string {
  const presentation = fileTypeIconPresentation(path);
  if (presentation.kind === "java") {
    return `<span aria-hidden="true" class="agent-markdown__file-icon agent-markdown__file-icon--java" style="--agent-markdown-file-icon-color:${presentation.color};width:${size}px;height:${size}px">${presentation.label}</span>`;
  }

  const width = presentation.icon.width ?? 16;
  const height = presentation.icon.height ?? 16;
  return `<svg aria-hidden="true" class="agent-markdown__file-icon" height="${size}" viewBox="0 0 ${width} ${height}" width="${size}">${presentation.icon.body}</svg>`;
}
