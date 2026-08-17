import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const sharedTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--app-foreground)",
    fontSize: "11px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: "1.6",
    overflow: "auto",
  },
  ".cm-content": {
    minWidth: "0",
    padding: "6px 0 40vh",
    caretColor: "var(--app-accent)",
  },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": {
    borderRight: "1px solid var(--app-border)",
    backgroundColor: "var(--app-panel-subtle)",
    color: "var(--app-muted-foreground)",
  },
  ".cm-gutterElement": { padding: "0 7px 0 6px" },
  ".cm-foldGutter .cm-gutterElement": {
    cursor: "pointer",
    color: "var(--app-muted-foreground)",
  },
  ".document-code-editor__fold-marker": {
    position: "relative",
    display: "block",
    width: "12px",
    height: "1.6em",
    margin: "0 auto",
    transformOrigin: "center",
  },
  ".document-code-editor__fold-marker::before, .document-code-editor__fold-marker::after": {
    position: "absolute",
    top: "9px",
    width: "6px",
    height: "1px",
    borderRadius: "1px",
    backgroundColor: "currentColor",
    content: '""',
  },
  ".document-code-editor__fold-marker::before": {
    left: "1px",
    transform: "rotate(32deg)",
    transformOrigin: "right center",
  },
  ".document-code-editor__fold-marker::after": {
    right: "1px",
    transform: "rotate(-32deg)",
    transformOrigin: "left center",
  },
  '.document-code-editor__fold-marker[data-open="false"]': {
    transform: "rotate(-90deg)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--app-accent) 8%, transparent)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--app-accent)",
    borderLeftWidth: "2px",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--app-accent) 16%, transparent)",
  },
});

const lightTheme = EditorView.theme({
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(37, 99, 235, 0.18)",
  },
}, { dark: false });

const darkTheme = EditorView.theme({
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(96, 165, 250, 0.26)",
  },
}, { dark: true });

const lightHighlight = HighlightStyle.define([
  { tag: [tags.tagName, tags.angleBracket], color: "#be123c" },
  { tag: tags.attributeName, color: "#1d4ed8" },
  { tag: tags.attributeValue, color: "#047857" },
  { tag: [tags.variableName, tags.typeName, tags.className], color: "#0f766e" },
  { tag: [tags.propertyName, tags.labelName], color: "#1d4ed8" },
  { tag: [tags.string, tags.special(tags.string)], color: "#047857" },
  { tag: [tags.number, tags.integer, tags.float], color: "#b45309" },
  { tag: [tags.bool, tags.null, tags.atom], color: "#7c3aed" },
  { tag: [tags.keyword, tags.modifier], color: "#be123c" },
  { tag: [tags.comment, tags.quote], color: "#64748b" },
  { tag: [tags.bracket, tags.punctuation, tags.operator], color: "#475569" },
  { tag: [tags.heading1, tags.heading2, tags.heading3, tags.strong], color: "#0f172a", fontWeight: "700" },
  { tag: [tags.link, tags.url], color: "#2563eb", textDecoration: "underline" },
], { themeType: "light" });

const darkHighlight = HighlightStyle.define([
  { tag: [tags.tagName, tags.angleBracket], color: "#fda4af" },
  { tag: tags.attributeName, color: "#93c5fd" },
  { tag: tags.attributeValue, color: "#86efac" },
  { tag: [tags.variableName, tags.typeName, tags.className], color: "#5eead4" },
  { tag: [tags.propertyName, tags.labelName], color: "#93c5fd" },
  { tag: [tags.string, tags.special(tags.string)], color: "#86efac" },
  { tag: [tags.number, tags.integer, tags.float], color: "#fbbf24" },
  { tag: [tags.bool, tags.null, tags.atom], color: "#c4b5fd" },
  { tag: [tags.keyword, tags.modifier], color: "#fda4af" },
  { tag: [tags.comment, tags.quote], color: "#a1a1aa" },
  { tag: [tags.bracket, tags.punctuation, tags.operator], color: "#d4d4d8" },
  { tag: [tags.heading1, tags.heading2, tags.heading3, tags.strong], color: "#f8fafc", fontWeight: "700" },
  { tag: [tags.link, tags.url], color: "#93c5fd", textDecoration: "underline" },
], { themeType: "dark" });

export function documentCodeEditorTheme(isDark: boolean): Extension {
  return [
    sharedTheme,
    isDark ? darkTheme : lightTheme,
    syntaxHighlighting(isDark ? darkHighlight : lightHighlight),
  ];
}
