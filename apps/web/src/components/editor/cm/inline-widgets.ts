import { EditorView, WidgetType } from "@codemirror/view";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Globe2,
} from "lucide-react";
import { markdownCalloutIcon } from "../../markdown/markdown-callout-icon.js";
import type { MarkdownCalloutTone } from "../../../lib/markdown-callout.js";
import type { MarkdownFrontmatterEntry } from "../../../lib/markdown-frontmatter.js";
import { measuredBlockWidget, iconMarkup } from "./widget-dom.js";

export class MarkdownLinkIconWidget extends WidgetType {
  constructor(
    private readonly kind: "external" | "document",
    private readonly target: string,
    private readonly wikilinkFrom?: number,
  ) {
    super();
  }

  override eq(other: MarkdownLinkIconWidget): boolean {
    return other.kind === this.kind && other.target === this.target && other.wikilinkFrom === this.wikilinkFrom;
  }

  override toDOM(): HTMLElement {
    const icon = document.createElement("span");
    icon.className = `mk-cm-link-icon mk-cm-link-icon--${this.kind}`;
    icon.dataset.mkLinkTarget = this.target;
    if (this.wikilinkFrom !== undefined) icon.dataset.mkWikilinkFrom = String(this.wikilinkFrom);
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = iconMarkup(this.kind === "external" ? Globe2 : FileText);
    return icon;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** Obsidian 双链在编辑器中的紧凑渲染态。源码仍保存在文档里，只在选中时还原。 */
export class MarkdownWikilinkWidget extends WidgetType {
  constructor(
    private readonly kind: "external" | "document",
    private readonly target: string,
    private readonly label: string,
    private readonly wikilinkFrom: number,
    private readonly invalid: boolean,
  ) {
    super();
  }

  override eq(other: MarkdownWikilinkWidget): boolean {
    return other.kind === this.kind
      && other.target === this.target
      && other.label === this.label
      && other.wikilinkFrom === this.wikilinkFrom
      && other.invalid === this.invalid;
  }

  override toDOM(): HTMLElement {
    const link = document.createElement("span");
    link.className = `mk-cm-link mk-cm-link--${this.kind} mk-cm-link--wikilink${this.invalid ? " mk-cm-link--invalid" : ""}`;
    link.dataset.mkLinkTarget = this.target;
    link.dataset.mkWikilinkFrom = String(this.wikilinkFrom);
    if (this.invalid) link.dataset.mkWikilinkInvalid = "true";
    link.setAttribute("role", "link");
    link.setAttribute("aria-label", this.invalid ? `非 Markdown 文件：${this.target}` : `打开文档：${this.target}`);
    link.title = this.invalid ? "仅支持 Markdown 文档" : this.target;

    const icon = document.createElement("span");
    icon.className = `mk-cm-link-icon mk-cm-link-icon--${this.kind}${this.invalid ? " mk-cm-link-icon--invalid" : ""}`;
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = iconMarkup(this.kind === "external" ? Globe2 : FileText);
    link.append(icon);
    renderWikilinkFormattedLabel(link, this.label);
    return link;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

function renderWikilinkFormattedLabel(container: HTMLElement, label: string): void {
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(label)) !== null) {
    if (match.index > lastIndex) {
      container.append(document.createTextNode(label.slice(lastIndex, match.index)));
    }
    if (match[2] !== undefined) {
      const strong = document.createElement("strong");
      strong.className = "mk-cm-strong";
      strong.textContent = match[2];
      container.append(strong);
    } else if (match[3] !== undefined) {
      const em = document.createElement("em");
      em.className = "mk-cm-em";
      em.textContent = match[3];
      container.append(em);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < label.length) {
    container.append(document.createTextNode(label.slice(lastIndex)));
  }
}

export class MarkdownCalloutIconWidget extends WidgetType {
  constructor(
    private readonly type: string,
    private readonly tone: string,
    private readonly title: string,
    private readonly collapsed: boolean | undefined,
    private readonly calloutFrom: number | undefined,
    private readonly onToggle: ((view: EditorView) => void) | undefined,
  ) {
    super();
  }

  override eq(other: MarkdownCalloutIconWidget): boolean {
    return other.type === this.type
      && other.tone === this.tone
      && other.title === this.title
      && other.collapsed === this.collapsed
      && other.calloutFrom === this.calloutFrom;
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("span");
    host.className = `mk-cm-callout-heading-prefix${this.collapsed === undefined ? "" : " mk-cm-callout-toggle"}`;
    host.innerHTML = iconMarkup(markdownCalloutIcon(this.type, this.tone as MarkdownCalloutTone));
    if (this.calloutFrom === undefined || this.collapsed === undefined) {
      host.setAttribute("aria-hidden", "true");
    } else {
      host.dataset.mkCalloutToggle = "true";
      host.dataset.mkCalloutFrom = String(this.calloutFrom);
      host.setAttribute("role", "button");
      host.setAttribute("tabindex", "0");
      host.setAttribute("aria-expanded", String(!this.collapsed));
      host.setAttribute("aria-label", this.collapsed ? "展开引用块" : "收起引用块");

      const toggle = document.createElement("span");
      toggle.className = "mk-cm-callout-fold-icon";
      toggle.setAttribute("aria-hidden", "true");
      toggle.innerHTML = iconMarkup(this.collapsed ? ChevronRight : ChevronDown);
      host.prepend(toggle);
    }
    if (this.title) {
      const title = document.createElement("span");
      title.className = "mk-cm-callout-title";
      title.textContent = this.title;
      host.append(title);
    }

    if (this.onToggle) {
      host.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      host.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onToggle?.(view);
      });
      host.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        this.onToggle?.(view);
      });
    }
    return host;
  }

  override ignoreEvent(): boolean {
    return this.onToggle !== undefined;
  }
}

/** 文首 YAML 属性的紧凑预览。编辑时点击或选中属性区会恢复原始 YAML。 */
export class MarkdownFrontmatterWidget extends WidgetType {
  constructor(
    private readonly entries: readonly MarkdownFrontmatterEntry[],
    private readonly editable: boolean,
    private readonly sourceFrom: number,
  ) {
    super();
  }

  override eq(other: MarkdownFrontmatterWidget): boolean {
    return other.editable === this.editable
      && other.sourceFrom === this.sourceFrom
      && other.entries.length === this.entries.length
      && other.entries.every((entry, index) => (
        entry.key === this.entries[index]?.key
        && JSON.stringify(entry.value) === JSON.stringify(this.entries[index]?.value)
      ));
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("section");
    host.className = `mk-cm-frontmatter${this.editable ? " mk-cm-frontmatter--editable" : ""}`;
    host.setAttribute("aria-label", "文档属性");
    if (this.editable) {
      host.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const row = (event.target as Element | null)?.closest<HTMLElement>(".mk-cm-frontmatter-row");
        const lineFrom = row ? Number(row.dataset.sourceFrom) : this.sourceFrom;
        const anchor = view.state.doc.lineAt(lineFrom).to;
        view.dispatch({ selection: { anchor }, scrollIntoView: true });
        view.focus();
      });
    }

    const heading = document.createElement("div");
    heading.className = "mk-cm-frontmatter-heading";
    heading.textContent = "文档属性";
    host.append(heading);

    const properties = document.createElement("div");
    properties.className = "mk-cm-frontmatter-properties";
    for (const entry of this.entries) {
      const row = document.createElement("div");
      row.className = "mk-cm-frontmatter-row";
      row.dataset.sourceFrom = String(entry.sourceFrom);

      const key = document.createElement("span");
      key.className = "mk-cm-frontmatter-key";
      key.textContent = entry.key;

      const value = document.createElement("span");
      value.className = "mk-cm-frontmatter-value";
      const values = Array.isArray(entry.value) ? entry.value : [entry.value];
      if (values.length === 0) {
        value.textContent = "-";
      } else if (Array.isArray(entry.value)) {
        values.forEach((item) => {
          const tag = document.createElement("span");
          tag.className = "mk-cm-frontmatter-tag";
          tag.textContent = item;
          value.append(tag);
        });
      } else {
        value.textContent = values[0] ?? "";
      }
      row.append(key, value);
      properties.append(row);
    }
    host.append(properties);
    return measuredBlockWidget(host, "frontmatter");
  }

  override ignoreEvent(): boolean {
    return true;
  }
}
