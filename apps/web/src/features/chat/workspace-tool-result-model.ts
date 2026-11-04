import { conversationAttachmentListSchema, type ConversationAttachment } from "@agent/protocol";
import { parseToolValue } from "./tool-result-payload.js";

export function parseBrowserScreenshot(payload: string): { width: number; height: number; mimeType: string; images: ConversationAttachment[] } | null {
  const result = parseToolValue(payload);
  const images = conversationAttachmentListSchema.safeParse(result?.images ?? [result?.image]);
  return (result?.coordinateSpace === "screenshot_css_pixels" || result?.coordinateSpace === "window_physical_pixels") && typeof result.width === "number"
    && typeof result.height === "number" && typeof result.mimeType === "string"
    ? { width: result.width, height: result.height, mimeType: result.mimeType, images: images.success ? images.data.slice(0, 3) : [] } : null;
}

export function parseProjectInfoResult(payload: string): {
  name: string;
  rootPath: string;
} | null {
  const result = parseToolValue(payload);
  return typeof result?.name === "string" && typeof result.rootPath === "string"
    ? { name: result.name, rootPath: result.rootPath }
    : null;
}

type ProjectOperationPayload = {
  conversationTitle: string;
  operationId: string;
  scope: { command: string; kind: "command" } | { kind: "file"; path: string };
  status: "active" | "completed" | "failed";
};

export function parseProjectOperationResult(
  payload: string,
  mode: "list" | "wait",
): {
  operations: ProjectOperationPayload[];
  waitStatus: "finished" | "timeout" | null;
} | null {
  const result = parseToolValue(payload);
  if (result === null) return null;
  const rawOperations = mode === "list"
    ? result.operations
    : result.operation === null || typeof result.operation !== "object"
      ? null
      : [result.operation];
  if (!Array.isArray(rawOperations)) return null;
  const operations = rawOperations.map(parseProjectOperation);
  if (operations.some((operation) => operation === null)) return null;
  return {
    operations: operations as ProjectOperationPayload[],
    waitStatus: result.waitStatus === "finished" || result.waitStatus === "timeout"
      ? result.waitStatus
      : null,
  };
}

function parseProjectOperation(value: unknown): ProjectOperationPayload | null {
  if (value === null || typeof value !== "object") return null;
  const operation = value as Record<string, unknown>;
  if (
    typeof operation.conversationTitle !== "string"
    || typeof operation.operationId !== "string"
    || (operation.status !== "active" && operation.status !== "completed" && operation.status !== "failed")
    || operation.scope === null
    || typeof operation.scope !== "object"
  ) {
    return null;
  }
  const scope = operation.scope as Record<string, unknown>;
  const parsedScope = scope.kind === "file" && typeof scope.path === "string"
    ? { kind: "file" as const, path: scope.path }
    : scope.kind === "command" && typeof scope.command === "string"
      ? { command: scope.command, kind: "command" as const }
      : null;
  return parsedScope === null
    ? null
    : {
      conversationTitle: operation.conversationTitle,
      operationId: operation.operationId,
      scope: parsedScope,
      status: operation.status,
    };
}

export function projectOperationStatusLabel(status: ProjectOperationPayload["status"]): string {
  switch (status) {
    case "active":
      return "进行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
  }
}

export function parseDirectoryListingResult(payload: string): {
  directoryPath: string;
  entries: Array<{ kind: "directory" | "file" | "symlink"; name: string; path: string }>;
  truncated: boolean;
} | null {
  const result = parseToolValue(payload);
  if (
    typeof result?.directoryPath !== "string" ||
    !Array.isArray(result.entries) ||
    typeof result.truncated !== "boolean"
  ) {
    return null;
  }

  const entries = result.entries.map((entry) => {
    if (entry === null || typeof entry !== "object") return null;
    const value = entry as Record<string, unknown>;
    return typeof value.name === "string" &&
      typeof value.path === "string" &&
      (value.kind === "directory" || value.kind === "file" || value.kind === "symlink")
      ? { kind: value.kind, name: value.name, path: value.path }
      : null;
  });

  return entries.every((entry) => entry !== null)
    ? {
      directoryPath: result.directoryPath,
      entries: entries as Array<{
        kind: "directory" | "file" | "symlink";
        name: string;
        path: string;
      }>,
      truncated: result.truncated
    }
    : null;
}

export function parseSearchTextResult(payload: string): {
  matches: Array<{ line: number; path: string; text: string }>;
  mode: "literal" | "regex";
  scannedFiles: number | null;
  truncated: boolean;
} | null {
  const result = parseToolValue(payload);
  if (!Array.isArray(result?.matches) || typeof result.truncated !== "boolean") return null;
  const matches = result.matches.map((match) => {
    if (match === null || typeof match !== "object") return null;
    const value = match as Record<string, unknown>;
    return typeof value.line === "number" &&
      typeof value.path === "string" &&
      typeof value.text === "string"
      ? { line: value.line, path: value.path, text: value.text }
      : null;
  });
  return matches.every((match) => match !== null)
    ? {
      matches: matches.filter((match) => match !== null),
      mode: result.mode === "regex" ? "regex" : "literal",
      scannedFiles: typeof result.scannedFiles === "number" ? result.scannedFiles : null,
      truncated: result.truncated
    }
    : null;
}

export function parseWebSearchResult(payload: string): {
  results: Array<{ description: string; hostname: string; title: string; url: string }>;
} | null {
  const result = parseToolValue(payload);
  if (!Array.isArray(result?.results)) return null;
  const results = result.results.map((item) => {
    if (item === null || typeof item !== "object") return null;
    const value = item as Record<string, unknown>;
    return typeof value.description === "string" &&
      typeof value.hostname === "string" &&
      typeof value.title === "string" &&
      typeof value.url === "string"
      ? {
        description: value.description,
        hostname: value.hostname,
        title: value.title,
        url: value.url,
      }
      : null;
  });
  return results.every((item) => item !== null)
    ? { results: results.filter((item) => item !== null) }
    : null;
}

export function parseFindFilesResult(payload: string): {
  matches: string[];
  pattern: string;
  truncated: boolean;
} | null {
  const result = parseToolValue(payload);
  return Array.isArray(result?.matches) &&
    result.matches.every((match) => typeof match === "string") &&
    typeof result.pattern === "string" &&
    typeof result.truncated === "boolean"
    ? {
      matches: result.matches,
      pattern: result.pattern,
      truncated: result.truncated
    }
    : null;
}

export function parseFileReadResult(payload: string): {
  content: string;
  endLine: number;
  path: string;
  startLine: number;
  totalLines: number | null;
} | null {
  const result = parseToolValue(payload);
  return typeof result?.content === "string" &&
    typeof result.endLine === "number" &&
    typeof result.path === "string" &&
    typeof result.startLine === "number" &&
    (result.totalLines === null || typeof result.totalLines === "number")
    ? {
      content: result.content,
      endLine: result.endLine,
      path: result.path,
      startLine: result.startLine,
      totalLines: result.totalLines
    }
    : null;
}

export function parseAttachmentReadResult(payload: string): {
  content: string;
  endOffset: number;
  name: string;
  startOffset: number;
  totalCharacters: number;
  truncated: boolean;
} | null {
  const result = parseToolValue(payload);
  return typeof result?.content === "string"
    && typeof result.endOffset === "number"
    && typeof result.name === "string"
    && typeof result.startOffset === "number"
    && typeof result.totalCharacters === "number"
    && typeof result.truncated === "boolean"
    ? {
      content: result.content,
      endOffset: result.endOffset,
      name: result.name,
      startOffset: result.startOffset,
      totalCharacters: result.totalCharacters,
      truncated: result.truncated,
    }
    : null;
}

export function parseAttachmentViewResult(payload: string): ConversationAttachment[] | null {
  const result = parseToolValue(payload);
  const parsed = conversationAttachmentListSchema.safeParse(result?.attachments);
  return parsed.success ? parsed.data : null;
}

export function fileNameFromPath(path: string): string {
  const normalizedPath = path.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(normalizedPath.lastIndexOf("/"), normalizedPath.lastIndexOf("\\"));
  return separatorIndex < 0 ? normalizedPath || path : normalizedPath.slice(separatorIndex + 1);
}
