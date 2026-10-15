import { defaultKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { memo, useEffect, useMemo, useRef, type ReactElement } from "react";
import { highlightCode, isLargeCodeSource } from "./code-highlighter.js";

// CodeMirror's viewport and long-line gaps bound DOM size without truncating source.
const sourceTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--app-muted)", color: "var(--app-foreground)", fontSize: "var(--app-font-size-body)" },
  "&.cm-focused": { outline: "2px solid var(--app-focus-ring)", outlineOffset: "-2px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: "1.55" },
  ".cm-content": { padding: "8px 0" },
  ".cm-line": { padding: "0 9px" },
  ".cm-selectionBackground": { backgroundColor: "var(--app-selection)" },
});

export const CodeSourceView = memo(function CodeSourceView({ source, language }: { source: string; language: string }): ReactElement {
  const large = isLargeCodeSource(source);
  const highlighted = useMemo(() => large ? "" : highlightCode(source, language), [large, source, language]);
  return large ? <VirtualCodeSource source={source} /> : (
    <pre className="m-0 max-h-96 overflow-auto bg-[var(--app-muted)] p-2 font-mono text-[length:var(--app-font-size-control)]">
      <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  );
});

function VirtualCodeSource({ source }: { source: string }): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  let visibleLines = 1;
  for (let index = source.indexOf("\n"); index !== -1 && visibleLines < 20; index = source.indexOf("\n", index + 1)) visibleLines += 1;
  useEffect(() => {
    if (host.current === null) return;
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: source, extensions: [
      sourceTheme, EditorState.readOnly.of(true), EditorView.editable.of(false), keymap.of(defaultKeymap),
      EditorView.contentAttributes.of({ "aria-label": "代码源码", "aria-readonly": "true", tabindex: "0" }),
    ] }) });
    return () => view.destroy();
  }, [source]);
  return <div ref={host} className="max-h-[55dvh] min-w-0 overflow-hidden bg-[var(--app-muted)]" style={{ height: `min(384px, calc(${visibleLines} * 1.55 * var(--app-font-size-body) + 32px))` }} data-virtual-code-source />;
}
