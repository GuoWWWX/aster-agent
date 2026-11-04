import { EditorView } from "@codemirror/view";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type LucideIcon } from "lucide-react";

export function copyTextToClipboard(text: string, onSuccess: () => void): void {
  const fallback = () => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    } catch { /* Clipboard access can be denied by the host. */ }
    onSuccess();
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(text).then(onSuccess).catch(fallback);
  } else {
    fallback();
  }
}

export function measuredBlockWidget(content: HTMLElement, spacing: "frontmatter" | "media" | "table"): HTMLElement {
  const container = document.createElement("div");
  container.className = `mk-cm-block-widget-spacing mk-cm-block-widget-spacing--${spacing}`;
  container.append(content);
  return container;
}

/**
 * Mermaid 图表。
 *
 * mermaid 的渲染是异步的，widget 的 toDOM 必须同步返回，所以这里先返回一个
 * 容器：命中缓存就直接填图（切换光标进出时不会闪空白），否则先占位再异步补上。
 */
export function isDarkEditorView(view: EditorView): boolean {
  return view.dom.closest('[data-theme="dark"]') !== null
    || document.documentElement.dataset.theme === "dark"
    || document.body.dataset.theme === "dark";
}

export function iconMarkup(icon: LucideIcon): string {
  return renderToStaticMarkup(createElement(icon, { size: 14, strokeWidth: 2 }));
}

export const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
export const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
