import { relativeProjectPathSchema } from "@agent/protocol";

function normalizePath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/** Resolve local Markdown links inside the current workspace before invoking its file port. */
export function resolveWorkspaceFileLink(href: string): string | null {
  let path: string;
  try { path = decodeURIComponent(href.trim().split(/[?#]/u)[0] ?? ""); }
  catch { return null; }
  path = path.replaceAll("\\", "/");
  if (!path || path.startsWith("/") || /^[a-z][a-z\d+.-]*:/iu.test(path) || path.includes("\u0000")) return null;
  const normalized = normalizePath(path);
  if (normalized === null || /^[a-z][a-z\d+.-]*:/iu.test(normalized)) return null;
  const parsed = relativeProjectPathSchema.safeParse(normalized);
  return parsed.success && parsed.data.length > 0 ? parsed.data : null;
}
