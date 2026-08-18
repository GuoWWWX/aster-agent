import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import { rgPath } from "@vscode/ripgrep";

const MAX_SEARCH_MATCH_TEXT_LENGTH = 800;
const MAX_ERROR_OUTPUT_LENGTH = 4_000;
const MAX_FILE_SIZE = 512 * 1024;
const SKIPPED_DIRECTORY_GLOBS = [
  "!**/.git/**",
  "!**/.idea/**",
  "!**/.vscode/**",
  "!**/coverage/**",
  "!**/dist/**",
  "!**/node_modules/**",
  "!**/target/**",
];

type RipgrepJsonEvent = {
  data?: {
    line_number?: number;
    lines?: { text?: string };
    path?: { text?: string };
    stats?: { searches?: number };
  };
  type?: string;
};

export type RipgrepTextMatch = {
  line: number;
  path: string;
  text: string;
};

export type RipgrepTextSearchResult = {
  matches: RipgrepTextMatch[];
  scannedFiles: number;
  truncated: boolean;
};

export type RipgrepCaseMode = "smart" | "sensitive" | "insensitive";
export type RipgrepSearchMode = "literal" | "regex";

export type RipgrepFileSearchResult = {
  matches: string[];
  scannedEntries: number;
  truncated: boolean;
};

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The search was aborted.", "AbortError");
}

function normalizeRelativePath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}

function searchExcerpt(line: string): string {
  const normalized = line.trim();
  return normalized.length <= MAX_SEARCH_MATCH_TEXT_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_SEARCH_MATCH_TEXT_LENGTH)}...`;
}

function decodeRgText(value: string | undefined): string {
  return value ?? "";
}

async function runRipgrep(
  args: string[],
  cwd: string,
  signal: AbortSignal,
  onLine: (line: string) => boolean,
  separator = "\n",
): Promise<{ exitCode: number | null; stderr: string; stoppedEarly: boolean }> {
  throwIfAborted(signal);
  return await new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let stdoutBuffer = "";
    let stderr = "";
    let stoppedEarly = false;
    let handlerError: unknown = null;
    let settled = false;

    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const processLine = (line: string): void => {
      if (line.length === 0 || stoppedEarly || handlerError !== null) return;
      try {
        if (!onLine(line)) {
          stoppedEarly = true;
          child.kill();
        }
      } catch (error) {
        handlerError = error;
        child.kill();
      }
    };
    const consumeStdout = (chunk: Buffer): void => {
      stdoutBuffer += stdoutDecoder.write(chunk);
      const lines = stdoutBuffer.split(separator);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(separator === "\n" && line.endsWith("\r") ? line.slice(0, -1) : line);
      }
    };
    const onAbort = (): void => {
      child.kill();
    };

    child.stdout.on("data", consumeStdout);
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length >= MAX_ERROR_OUTPUT_LENGTH) return;
      stderr += stderrDecoder.write(chunk).slice(0, MAX_ERROR_OUTPUT_LENGTH - stderr.length);
    });
    child.once("error", fail);
    child.once("close", (exitCode) => {
      stdoutBuffer += stdoutDecoder.end();
      if (!stoppedEarly) {
        processLine(
          separator === "\n" && stdoutBuffer.endsWith("\r")
            ? stdoutBuffer.slice(0, -1)
            : stdoutBuffer,
        );
      }
      stderr += stderrDecoder.end();
      cleanup();
      if (settled) return;
      if (signal.aborted) {
        fail(signal.reason instanceof Error ? signal.reason : new DOMException("The search was aborted.", "AbortError"));
        return;
      }
      if (handlerError !== null) {
        fail(handlerError);
        return;
      }
      settled = true;
      resolve({ exitCode, stderr: stderr.trim(), stoppedEarly });
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function parseJsonEvent(line: string): RipgrepJsonEvent | null {
  try {
    const value = JSON.parse(line) as unknown;
    return value !== null && typeof value === "object"
      ? value
      : null;
  } catch {
    return null;
  }
}

function errorForRipgrep(exitCode: number | null, stderr: string): Error {
  return new Error(stderr || `ripgrep exited with code ${exitCode ?? "unknown"}.`);
}

export async function searchTextWithRipgrep(input: {
  caseMode: RipgrepCaseMode;
  excludeGlobs: string[];
  includeGlobs: string[];
  maxResults: number;
  mode: RipgrepSearchMode;
  path: string;
  query: string;
  projectRoot: string;
  signal: AbortSignal;
}): Promise<RipgrepTextSearchResult> {
  const matches: RipgrepTextMatch[] = [];
  const matchedFiles = new Set<string>();
  let scannedFiles = 0;
  let truncated = false;
  const result = await runRipgrep(
    [
      "--json",
      ...(input.mode === "literal" ? ["--fixed-strings"] : []),
      ...ripgrepCaseArguments(input.caseMode),
      "--line-number",
      "--no-require-git",
      "--color",
      "never",
      "--max-filesize",
      String(MAX_FILE_SIZE),
      ...input.includeGlobs.flatMap((glob) => ["--glob", glob]),
      ...input.excludeGlobs.flatMap((glob) => ["--glob", excludedGlob(glob)]),
      ...SKIPPED_DIRECTORY_GLOBS.flatMap((glob) => ["--glob", glob]),
      "--",
      input.query,
      input.path.length === 0 ? "." : input.path,
    ],
    input.projectRoot,
    input.signal,
    (line) => {
      const event = parseJsonEvent(line);
      if (event?.type === "match") {
        const relativePath = normalizeRelativePath(decodeRgText(event.data?.path?.text));
        const lineNumber = event.data?.line_number;
        if (relativePath.length > 0 && typeof lineNumber === "number") {
          matchedFiles.add(relativePath);
          matches.push({
            line: lineNumber,
            path: relativePath,
            text: searchExcerpt(decodeRgText(event.data?.lines?.text)),
          });
          if (matches.length >= input.maxResults) {
            truncated = true;
            return false;
          }
        }
      } else if (event?.type === "summary" && typeof event.data?.stats?.searches === "number") {
        scannedFiles = event.data.stats.searches;
      }
      return true;
    },
  );
  if (result.exitCode !== null && result.exitCode > 1 && !result.stoppedEarly) {
    throw errorForRipgrep(result.exitCode, result.stderr);
  }
  return {
    matches,
    scannedFiles: Math.max(scannedFiles, matchedFiles.size),
    truncated,
  };
}

function ripgrepCaseArguments(caseMode: RipgrepCaseMode): string[] {
  switch (caseMode) {
    case "smart":
      return ["--smart-case"];
    case "sensitive":
      return ["--case-sensitive"];
    case "insensitive":
      return ["--ignore-case"];
  }
}

function excludedGlob(glob: string): string {
  return glob.startsWith("!") ? glob : `!${glob}`;
}

export async function findFilesWithRipgrep(input: {
  maxResults: number;
  path: string;
  pattern: string;
  projectRoot: string;
  signal: AbortSignal;
}): Promise<RipgrepFileSearchResult> {
  const matches: string[] = [];
  let truncated = false;
  const result = await runRipgrep(
    [
      "--files",
      "--null",
      "--no-require-git",
      "--color",
      "never",
      "--glob",
      input.pattern,
      ...SKIPPED_DIRECTORY_GLOBS.flatMap((glob) => ["--glob", glob]),
      "--",
      input.path.length === 0 ? "." : input.path,
    ],
    input.projectRoot,
    input.signal,
    (line) => {
      const relativePath = normalizeRelativePath(line);
      if (relativePath.length === 0) return true;
      matches.push(relativePath);
      if (matches.length >= input.maxResults) {
        truncated = true;
        return false;
      }
      return true;
    },
    "\0",
  );
  if (result.exitCode !== null && result.exitCode > 1 && !result.stoppedEarly) {
    throw errorForRipgrep(result.exitCode, result.stderr);
  }
  matches.sort((left, right) => left.localeCompare(right));
  return {
    matches,
    scannedEntries: matches.length,
    truncated,
  };
}
