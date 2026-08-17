import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as codeMirrorPlaceholder,
  rectangularSelection,
} from "@codemirror/view";
import { useEffect, useRef, type ReactElement } from "react";

import { documentCodeEditorTheme } from "./document-code-editor-theme.js";
import "./document-code-editor.css";

export type DocumentCodeLanguage =
  | "css"
  | "html"
  | "java"
  | "javascript"
  | "json"
  | "markdown"
  | "plain"
  | "typescript";

type DocumentCodeEditorProps = {
  ariaLabel: string;
  className?: string;
  isDark: boolean;
  language: DocumentCodeLanguage;
  onChange: (value: string) => void;
  onSave?: () => void;
  placeholder?: string;
  readOnly?: boolean;
  value: string;
};

const externalUpdate = Annotation.define<boolean>();

function createFoldMarker(open: boolean): HTMLElement {
  const marker = document.createElement("span");
  marker.className = "document-code-editor__fold-marker";
  marker.dataset.open = String(open);
  marker.setAttribute("aria-hidden", "true");
  return marker;
}

function languageExtension(language: DocumentCodeLanguage): Extension {
  switch (language) {
    case "css":
      return css();
    case "html":
      return html();
    case "java":
      return java();
    case "javascript":
      return javascript({ jsx: true });
    case "json":
      return json();
    case "markdown":
      return markdown();
    case "typescript":
      return javascript({ jsx: true, typescript: true });
    case "plain":
      return [];
  }
}

export function DocumentCodeEditor({
  ariaLabel,
  className = "",
  isDark,
  language,
  onChange,
  onSave,
  placeholder,
  readOnly = false,
  value,
}: DocumentCodeEditorProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const initialValueRef = useRef(value);
  const initialLanguageRef = useRef(language);
  const initialThemeRef = useRef(isDark);
  const languageCompartmentRef = useRef(new Compartment());
  const themeCompartmentRef = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  }, [onChange, onSave]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter({ markerDOM: createFoldMarker }),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      EditorView.editable.of(!readOnly),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            onSaveRef.current?.();
            return onSaveRef.current !== undefined;
          },
        },
      ]),
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      languageCompartmentRef.current.of(languageExtension(initialLanguageRef.current)),
      themeCompartmentRef.current.of(documentCodeEditorTheme(initialThemeRef.current)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalUpdate))) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ];
    if (placeholder !== undefined) extensions.push(codeMirrorPlaceholder(placeholder));

    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: initialValueRef.current, extensions }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [ariaLabel, placeholder, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null || view.state.doc.toString() === value) return;
    view.dispatch({
      annotations: externalUpdate.of(true),
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageCompartmentRef.current.reconfigure(languageExtension(language)),
    });
  }, [language]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartmentRef.current.reconfigure(documentCodeEditorTheme(isDark)),
    });
  }, [isDark]);

  return <div className={`document-code-editor ${className}`.trim()} ref={hostRef} />;
}
