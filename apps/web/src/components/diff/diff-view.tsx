import { useMemo, type ReactElement } from "react";

import { highlightCode, languageFromPath } from "../markdown/code-highlighter.js";

import "./diff-view.css";

export type DiffLineKind = "addition" | "collapsed" | "deletion" | "context";

export type DiffPresentation = {
  additions: number;
  deletions: number;
  lines: Array<{
    content: string;
    kind: DiffLineKind;
    lineNumber: number | null;
    omittedLines?: number;
  }>;
  path: string;
};

export function DiffView({
  onExpandContext,
  presentation,
}: {
  onExpandContext?: () => void;
  presentation: DiffPresentation;
}): ReactElement {
  const language = languageFromPath(presentation.path);
  const highlightedLines = useMemo(
    () => presentation.lines.map((line) => (
      line.kind === "collapsed" ? "" : highlightCode(line.content || " ", language)
    )),
    [language, presentation.lines],
  );

  return (
    <pre className="tool-diff-view">
      <code className="hljs">
        {presentation.lines.length === 0 ? (
          <span className="tool-diff-view__empty">文件不包含可显示的文本内容。</span>
        ) : presentation.lines.map((line, index) => (
          <span key={`${index}:${line.content}`} className="tool-diff-view__line" data-kind={line.kind}>
            <span className="tool-diff-view__line-number">{line.lineNumber ?? ""}</span>
            {line.kind === "collapsed" ? (
              <button
                className="tool-diff-view__collapsed-context"
                disabled={onExpandContext === undefined}
                type="button"
                onClick={onExpandContext}
              >
                {onExpandContext === undefined
                  ? `已省略 ${line.omittedLines ?? 0} 行未修改内容`
                  : `已省略 ${line.omittedLines ?? 0} 行未修改内容，展开查看更多上下文`}
              </button>
            ) : (
              <span
                className="tool-diff-view__line-content"
                dangerouslySetInnerHTML={{ __html: highlightedLines[index] ?? " " }}
              />
            )}
          </span>
        ))}
      </code>
    </pre>
  );
}

export function createDiffPresentation(diff: string): DiffPresentation {
  const sourceLines = diff.split(/\r?\n/u);
  if (sourceLines.at(-1) === "") sourceLines.pop();

  const headerPath = sourceLines.find((line) => line.startsWith("+++ "))?.slice(4).split("\t")[0];
  const fallbackPath = sourceLines.find((line) => line.startsWith("--- "))?.slice(4).split("\t")[0];
  const rawPath = (headerPath !== undefined && headerPath !== "/dev/null"
    ? headerPath
    : fallbackPath !== undefined && fallbackPath !== "/dev/null"
      ? fallbackPath
      : undefined) ?? "文件变更";
  const path = rawPath.replace(/^[ab]\//u, "");
  const lines: DiffPresentation["lines"] = [];
  let additions = 0;
  let deletions = 0;
  let oldLineNumber = 0;
  let newLineNumber = 0;

  for (const sourceLine of sourceLines) {
    const hunk = sourceLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk !== null) {
      const nextOldLineNumber = Number(hunk[1]);
      const nextNewLineNumber = Number(hunk[2]);
      const omittedLines = Math.max(
        nextOldLineNumber - oldLineNumber,
        nextNewLineNumber - newLineNumber,
      );
      if (lines.length > 0 && omittedLines > 0) {
        lines.push({
          content: "",
          kind: "collapsed",
          lineNumber: null,
          omittedLines,
        });
      }
      oldLineNumber = nextOldLineNumber;
      newLineNumber = nextNewLineNumber;
      continue;
    }
    if (isPatchMetadataLine(sourceLine)) {
      continue;
    }

    if (sourceLine.startsWith("+")) {
      additions += 1;
      lines.push({
        content: sourceLine.slice(1),
        kind: "addition",
        lineNumber: newLineNumber === 0 ? null : newLineNumber,
      });
      newLineNumber += 1;
      continue;
    }
    if (sourceLine.startsWith("-")) {
      deletions += 1;
      lines.push({
        content: sourceLine.slice(1),
        kind: "deletion",
        lineNumber: oldLineNumber === 0 ? null : oldLineNumber,
      });
      oldLineNumber += 1;
      continue;
    }

    if (sourceLine.length === 0 && oldLineNumber === 0 && newLineNumber === 0) continue;
    lines.push({
      content: sourceLine.startsWith(" ") ? sourceLine.slice(1) : sourceLine,
      kind: "context",
      lineNumber: newLineNumber === 0 ? null : newLineNumber,
    });
    oldLineNumber += 1;
    newLineNumber += 1;
  }

  return { additions, deletions, lines, path };
}

function isPatchMetadataLine(line: string): boolean {
  return (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("Index:") ||
    line.startsWith("===") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("\\ No newline") ||
    /^(?:new|deleted|old) file mode \d+$/u.test(line) ||
    /^(?:new|old) mode \d+$/u.test(line) ||
    /^(?:dis)?similarity index \d+%$/u.test(line) ||
    /^(?:rename|copy) (?:from|to) /u.test(line) ||
    line === "GIT binary patch" ||
    line.startsWith("Binary files ")
  );
}
