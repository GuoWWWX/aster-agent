export type TerminalTokenKind = "default" | "command" | "parameter" | "string" | "variable"
  | "number" | "address" | "path" | "operator" | "comment";
export type TerminalToken = { start: number; end: number; kind: TerminalTokenKind };

function isAddress(value: string): boolean {
  if (/^\d+(?:\.\d+){3}$/u.test(value)) return value.split(".").every((part) => Number(part) <= 255);
  if (value.includes(":")) {
    const host = value.split("%")[0] ?? "";
    if (!/^[\da-f:.]+$/iu.test(host)) return false;
    try { return new URL(`http://[${host}]/`).hostname.length > 0; } catch { return false; }
  }
  return /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}$/iu.test(value);
}

/** Lightweight display lexer, not a shell parser. No evaluation or environment access. */
export function terminalTokens(text: string, command: boolean): TerminalToken[] {
  const result: TerminalToken[] = [];
  // Alternatives consume whole strings/paths/hosts before numbers or punctuation.
  const lexemes = /"(?:[^"\\`\r\n]|\\.|`.)*(?:"|(?=\r?\n|$))|'(?:[^'\r\n]|'')*(?:'|(?=\r?\n|$))|https?:\/\/[^\s<>"'`]+|\$(?:\{[^}\r\n]*\}|[\w:?.]+)|%[a-z_]\w*%|--?[a-z_][\w-]*|(?:[a-z]:[\\/]|\\\\|\.{1,2}[\\/]|~?\/)[^\s"'<>|;]+|::[\da-f:.%]*|[a-z\d_][a-z\d_:.%µ~-]*|[\p{L}]+|[|;&=(){}<>]+|\s+|./giu;
  let expectsCommand = command;
  let cursor = 0;
  for (const match of text.matchAll(lexemes)) {
    if (result.length >= 7_998) break;
    if (match.index < cursor) continue;
    let value = match[0];
    let end = match.index + value.length;
    let kind: TerminalTokenKind = "default";
    if (command && value === "#" && (match.index === 0 || /\s/u.test(text[match.index - 1] ?? ""))) {
      end = text.indexOf("\n", match.index);
      if (end < 0) end = text.length;
      kind = "comment";
    } else if (/^\s+$/u.test(value)) {
      if (command && /\r|\n/u.test(value)) expectsCommand = true;
    } else if (/^["']/u.test(value)) {
      kind = "string";
      if (expectsCommand) expectsCommand = false;
    } else if (/^(?:\$|%[a-z_])/iu.test(value)) {
      kind = command ? "variable" : "default";
    } else if (/^[|;&=(){}<>]+$/u.test(value)) {
      kind = command ? "operator" : "default";
      if (command && /[|;&=({]/u.test(value)) expectsCommand = true;
    } else if (command && /^--?[a-z_]/iu.test(value)) {
      kind = "parameter";
    } else if (/^(?:[a-z]:[\\/]|\\\\|\.{1,2}[\\/]|~?\/)/iu.test(value)
      || /\.(?:tsx?|jsx?|jsonc?|md|log|txt|rs|py|ps1|sh|css|html)$/iu.test(value)) {
      kind = "path";
      if (expectsCommand) expectsCommand = false;
    } else if (command && expectsCommand && /^[a-z_][\w.-]*$/iu.test(value)) {
      kind = "command";
      expectsCommand = false;
    } else {
      // A colon terminating an IPv4/hostname is punctuation, not part of the address.
      const candidate = value.includes(".") ? value.replace(/:\d*$/u, "") : value;
      if (isAddress(candidate)) {
        kind = "address";
        value = candidate;
      } else if (/^\d+(?:\.\d+)?(?:%|ns|us|µs|ms|s|kb|mb|gb|tb|kib|mib|gib|bytes)?$/iu.test(value)) {
        kind = "number";
      }
    }
    if (match.index > cursor) result.push({ start: cursor, end: match.index, kind: "default" });
    const tokenEnd = kind === "address" ? match.index + value.length : end;
    result.push({ start: match.index, end: tokenEnd, kind });
    if (tokenEnd < end) {
      result.push({ start: tokenEnd, end: tokenEnd + 1, kind: "default" });
      if (tokenEnd + 1 < end) result.push({ start: tokenEnd + 1, end, kind: "number" });
    }
    cursor = end;
  }
  if (cursor < text.length) result.push({ start: cursor, end: text.length, kind: "default" });
  return result;
}
