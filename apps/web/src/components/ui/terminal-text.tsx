import { memo, type ReactNode } from "react";
import { terminalTokens, type TerminalTokenKind } from "./terminal-tokens.js";

export function terminalHttpLinks(text: string): { start: number; end: number; url: string }[] {
  const links: { start: number; end: number; url: string }[] = [];
  // ANSI escape ends a visible URL; do not include the following color sequence.
  // eslint-disable-next-line no-control-regex
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\u001b]+/giu)) {
    if (match[0].length > 8_192) continue;
    let url = match[0].replace(/[.,;:!?，。；：！？]+$/u, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
      let excess = url.split(close).length - url.split(open).length;
      while (url.endsWith(close) && excess > 0) {
        url = url.slice(0, -1);
        excess -= 1;
      }
    }
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password || url.includes("\\")
        || Array.from(url).some((character) => character.charCodeAt(0) < 32)) continue;
      links.push({ start: match.index, end: match.index + url.length, url });
    } catch { /* Invalid URL remains ordinary output. */ }
  }
  return links;
}

type SemanticTone = "default" | "error" | "warning" | "success" | "info" | "muted" | "purple" | "cyan" | "number";
type TerminalTone = SemanticTone | `rgb(${number}, ${number}, ${number})`;
const toneClasses: Record<SemanticTone, string> = {
  default: "text-[var(--app-foreground)]",
  error: "text-[var(--app-status-danger-fg)]",
  warning: "text-[var(--app-status-warning-fg)]",
  success: "text-[var(--app-status-success-fg)]",
  info: "text-[var(--app-accent)]",
  muted: "text-[var(--app-muted-foreground)]",
  purple: "text-purple-700 dark:text-purple-300",
  cyan: "text-cyan-700 dark:text-cyan-300",
  number: "text-amber-800 dark:text-amber-200",
};
const tokenTones: Record<TerminalTokenKind, TerminalTone> = {
  default: "default", command: "info", parameter: "purple", string: "success", variable: "cyan",
  number: "number", address: "cyan", path: "success", operator: "muted", comment: "muted",
};
const ansiTones: TerminalTone[] = ["muted", "error", "success", "warning", "info", "purple", "cyan", "default"];

function isSemanticTone(tone: TerminalTone): tone is SemanticTone { return !tone.startsWith("rgb("); }

function rgbTone(values: number[]): TerminalTone | null {
  if (values.length !== 3 || !values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) return null;
  return `rgb(${values[0] ?? 0}, ${values[1] ?? 0}, ${values[2] ?? 0})`;
}

function indexedTone(index: number): TerminalTone | null {
  if (!Number.isInteger(index) || index < 0 || index > 255) return null;
  if (index < 16) return ansiTones[index % 8] ?? null;
  if (index >= 232) return rgbTone(Array<number>(3).fill(8 + (index - 232) * 10));
  const cube = index - 16;
  return rgbTone([Math.floor(cube / 36), Math.floor(cube / 6) % 6, cube % 6].map((value) => value === 0 ? 0 : 55 + value * 40));
}

function outputTone(line: string): TerminalTone {
  const exitCode = /^\s*\[进程退出代码[:：]\s*(-?\d+)\]/u.exec(line);
  if (exitCode) return Number(exitCode[1]) === 0 ? "success" : "error";
  if (/^\s*\[命令执行超时\]/u.test(line)) return "error";
  if (/^\s*\[(?:输出已截断|命令已停止)\]/u.test(line)) return "warning";
  if (/^\s*\[命令执行完成/u.test(line)) return "success";
  if (/^\s*(?:(?:npm|pnpm)\s+)?(?:fatal\b|error\b|err!|ERR_[A-Z_]+\b|failed\b|失败[:：]|错误[:：]|✗|✖)/iu.test(line)) return "error";
  if (/^\s*(?:(?:npm|pnpm)\s+)?(?:warn(?:ing)?\b|警告[:：]|⚠)/iu.test(line)) return "warning";
  if (/^\s*(?:success(?:fully)?\b|done in\b|built in\b|成功[:：]|完成[:：]|✓|✔)/iu.test(line)) return "success";
  return "default";
}

function sgrTone(parameters: string, current: TerminalTone | null): TerminalTone | null {
  const codes = parameters === "" ? [0] : parameters.split(";").map(Number);
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index] ?? -1;
    if (code === 0 || code === 39) current = null;
    else if (code >= 30 && code <= 37) current = ansiTones[code - 30] ?? null;
    else if (code >= 90 && code <= 97) current = ansiTones[code - 90] ?? null;
    // Extended colors are one operation; backgrounds/underline colors do not recolor text.
    else if (code === 38 || code === 48 || code === 58) {
      if (code === 38) {
        const next = codes[index + 1] === 2 ? rgbTone(codes.slice(index + 2, index + 5))
          : codes[index + 1] === 5 ? indexedTone(codes[index + 2] ?? -1) : null;
        if (next !== null) current = next;
      }
      index += codes[index + 1] === 2 ? 4 : codes[index + 1] === 5 ? 2 : 0;
    }
  }
  return current;
}

/** Conversation output only: safe text + theme-aware foreground colors, never HTML or a PTY. */
export const TerminalText = memo(function TerminalText({ text, kind = "output" }: {
  text: string;
  kind?: "command" | "output";
}) {
  // Discard OSC titles/hyperlinks, including incomplete streaming sequences.
  // eslint-disable-next-line no-control-regex
  const visible = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/gu, "");
  const parts: ReactNode[] = [];
  let ansiTone: TerminalTone | null = null;
  let remainingSpans = 8_000;
  for (const line of visible.split(/(\r?\n)/u)) {
    if (line === "\n" || line === "\r\n") { parts.push(line); continue; }
    // eslint-disable-next-line no-control-regex
    const controls = /\x1b\[([0-?]*[ -/]*)([@-~])/gu;
    const runs: { start: number; end: number; tone: TerminalTone | null }[] = [];
    const plainParts: string[] = [];
    let length = 0;
    let cursor = 0;
    const append = (value: string) => {
      if (!value) return;
      const lastRun = runs.at(-1);
      if (runs.length >= 8_000 && lastRun) {
        lastRun.end = length + value.length;
        lastRun.tone = null;
      } else runs.push({ start: length, end: length + value.length, tone: ansiTone });
      plainParts.push(value);
      length += value.length;
    };
    for (const match of line.matchAll(controls)) {
      append(line.slice(cursor, match.index));
      if (match[2] === "m") ansiTone = sgrTone(match[1] ?? "", ansiTone);
      cursor = match.index + match[0].length;
    }
    // Hide an incomplete trailing CSI while output is still arriving.
    // eslint-disable-next-line no-control-regex
    append(line.slice(cursor).replace(/\x1b(?:\[[0-?]*[ -/]*)?$/u, ""));
    const plain = plainParts.join("");
    if (remainingSpans <= 0) { parts.push(plain); continue; }
    const fallback = kind === "command" ? "default" : outputTone(plain);
    const tokens = terminalTokens(plain, kind === "command");
    const links = terminalHttpLinks(plain);
    const boundaries = [...new Set([0, plain.length, ...tokens.map((token) => token.end),
      ...runs.map((run) => run.end), ...links.flatMap((link) => [link.start, link.end])])].sort((a, b) => a - b);
    const pieces: { text: string; tone: TerminalTone; href?: string }[] = [];
    let tokenIndex = 0;
    let runIndex = 0;
    let linkIndex = 0;
    for (let index = 0; index + 1 < boundaries.length; index += 1) {
      const start = boundaries[index] ?? 0;
      const end = boundaries[index + 1] ?? plain.length;
      while ((tokens[tokenIndex]?.end ?? Infinity) <= start) tokenIndex += 1;
      while ((runs[runIndex]?.end ?? Infinity) <= start) runIndex += 1;
      while ((links[linkIndex]?.end ?? Infinity) <= start) linkIndex += 1;
      const link = links[linkIndex];
      const href = link && link.start <= start ? link.url : undefined;
      const tone = runs[runIndex]?.tone ?? (fallback !== "default" ? fallback
        : href ? "info" : tokenTones[tokens[tokenIndex]?.kind ?? "default"]);
      const previous = pieces.at(-1);
      if (previous?.tone === tone && previous.href === href) previous.text += plain.slice(start, end);
      else {
        if (remainingSpans-- <= 0) { pieces.push({ text: plain.slice(start), tone: "default" }); break; }
        pieces.push({ text: plain.slice(start, end), tone, ...(href ? { href } : {}) });
      }
    }
    // Linkify after ANSI parsing so a color change inside a URL never breaks its target.
    let linkParts: ReactNode[] = [];
    let activeHref: string | undefined;
    const flushLink = () => {
      if (!activeHref) return;
      parts.push(<a key={parts.length} href={activeHref} target="_blank" rel="noopener noreferrer" title={activeHref}
        className="underline decoration-from-font underline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">{linkParts}</a>);
      linkParts = [];
    };
    for (const piece of pieces) {
      if (piece.href !== activeHref) { flushLink(); activeHref = piece.href; }
      const element = <span key={`${parts.length}-${linkParts.length}`}
        className={isSemanticTone(piece.tone) ? toneClasses[piece.tone] : undefined}
        style={isSemanticTone(piece.tone) ? undefined : {
          color: `light-dark(color-mix(in srgb, ${piece.tone} 45%, black), color-mix(in srgb, ${piece.tone} 50%, white))`,
        }} data-terminal-tone={piece.tone}>{piece.text}</span>;
      if (activeHref) linkParts.push(element); else parts.push(element);
    }
    flushLink();
  }
  return <>{parts}</>;
});
