import type { ProjectEntry } from "@agent/protocol";
import { AgentClientError, parseSerializedAgentError } from "@agent/protocol";
import type { DocumentCodeLanguage } from "../../components/editor/document-code-editor.js";
import type { FileSaveConflict } from "./sidebar-workspace-types.js";

export function languageForPath(path: string): DocumentCodeLanguage {
  const extension = path.split(".").at(-1)?.toLocaleLowerCase("en-US");
  switch (extension) {
    case "css":
    case "less":
    case "sass":
    case "scss":
      return "css";
    case "htm":
    case "html":
    case "vue":
    case "xml":
      return "html";
    case "java":
      return "java";
    case "cjs":
    case "js":
    case "jsx":
    case "mjs":
      return "javascript";
    case "json":
    case "jsonc":
      return "json";
    case "md":
    case "mdx":
      return "markdown";
    case "cts":
    case "mts":
    case "ts":
    case "tsx":
      return "typescript";
    default:
      return "plain";
  }
}

export function directoryPathForFile(path: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  return lastSlashIndex === -1 ? "" : normalizedPath.slice(0, lastSlashIndex);
}

export function directoryLabelForFile(path: string): string {
  return directoryPathForFile(path) || "项目根目录";
}

function fileExtension(path: string): string {
  return path.split(".").at(-1)?.toLocaleLowerCase("en-US") ?? "";
}

export function isMarkdownFile(path: string): boolean {
  const extension = fileExtension(path);
  return extension === "md" || extension === "mdx";
}

const PROJECT_PREVIEW_IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "ico",
  "jfif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

export function isProjectPreviewImagePath(path: string): boolean {
  return PROJECT_PREVIEW_IMAGE_EXTENSIONS.has(fileExtension(path));
}

export type ProjectImageNavigation = {
  currentIndex: number;
  next: ProjectEntry | null;
  previous: ProjectEntry | null;
  total: number;
};

export function projectImageNavigation(
  entries: readonly ProjectEntry[],
  currentPath: string,
): ProjectImageNavigation {
  const images = entries.filter(
    (entry) => entry.kind === "file" && isProjectPreviewImagePath(entry.path),
  );
  const currentIndex = images.findIndex((entry) => entry.path === currentPath);
  if (currentIndex < 0) {
    return { currentIndex: 0, next: null, previous: null, total: 1 };
  }
  return {
    currentIndex,
    next: images[currentIndex + 1] ?? null,
    previous: images[currentIndex - 1] ?? null,
    total: images.length,
  };
}

export function saveConflictFor(reason: unknown): FileSaveConflict | null {
  const code = reason instanceof AgentClientError
    ? reason.code
    : parseSerializedAgentError(reason)?.code
      ?? (reason !== null && typeof reason === "object" && "code" in reason
        && typeof reason.code === "string" ? reason.code : undefined);
  if (code === "CONFLICT" || code === "PROJECT_OPERATION_CONFLICT") return "locked";
  if (code === "FILE_CHANGED") return "stale";
  return null;
}
