import { COPY_ICON, CHECK_ICON } from "./widget-dom.js";
import { EditorView, WidgetType } from "@codemirror/view";
import { Code2, Expand } from "lucide-react";
import { getCachedMermaidSvg, renderMermaid } from "../../../lib/mermaid.js";
import { requestMediaPreview, svgDataUrl } from "../../media/image-viewer.js";
import { copyTextToClipboard, measuredBlockWidget, isDarkEditorView, iconMarkup } from "./widget-dom.js";
import { editMermaidSourceEffect } from "./widget-effects.js";

export function refreshLiveMermaidTheme(editorDom: HTMLElement, isDark: boolean): void {
  const hosts = editorDom.querySelectorAll<HTMLElement>(".mk-cm-mermaid");
  hosts.forEach((host) => {
    const canvas = host.querySelector<HTMLElement>(".mk-cm-mermaid-canvas");
    const source = host.dataset.mkMermaidSource;
    if (!canvas || !source) return;

    const cached = getCachedMermaidSvg(source, isDark);
    if (cached) {
      delete host.dataset.state;
      host.style.minHeight = "";
      canvas.innerHTML = cached.svg;
      return;
    }

    void renderMermaid(source, isDark)
      .then(({ svg }) => {
        if (!canvas.isConnected) return;
        delete host.dataset.state;
        host.style.minHeight = "";
        canvas.innerHTML = svg;
      })
      .catch((error: unknown) => {
        if (!canvas.isConnected) return;
        host.dataset.state = "error";
        host.style.minHeight = "";
        canvas.textContent = error instanceof Error ? error.message : "图表渲染失败";
      });
  });
}

export class MermaidWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly blockFrom: number,
    private readonly editable: boolean,
    private readonly caption?: string,
  ) {
    super();
  }

  override eq(other: MermaidWidget): boolean {
    return other.source === this.source
      && other.blockFrom === this.blockFrom
      && other.editable === this.editable
      && other.caption === this.caption;
  }

  override updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const host = dom.classList.contains("mk-cm-mermaid") ? dom : dom.querySelector<HTMLElement>(".mk-cm-mermaid");
    const canvas = dom.querySelector<HTMLElement>(".mk-cm-mermaid-canvas");
    if (!host || !canvas) return false;

    const isDark = isDarkEditorView(view);
    const cached = getCachedMermaidSvg(this.source, isDark);
    if (cached) {
      delete host.dataset.state;
      host.style.minHeight = "";
      canvas.innerHTML = cached.svg;
      return true;
    }

    // 若新主题尚未缓存，保留当前现有 SVG 画面与物理尺寸（零坍塌），在后台无感完成重绘替换
    void renderMermaid(this.source, isDark)
      .then(({ svg }) => {
        if (!canvas.isConnected) return;
        delete host.dataset.state;
        host.style.minHeight = "";
        canvas.innerHTML = svg;
      })
      .catch((error: unknown) => {
        if (!canvas.isConnected) return;
        host.dataset.state = "error";
        host.style.minHeight = "";
        canvas.textContent = error instanceof Error ? error.message : "图表渲染失败";
      });

    return true;
  }

  override toDOM(view: EditorView): HTMLElement {
    // 分两层：外层负责边框，内层专门放 SVG。
    const host = document.createElement("div");
    host.className = "mk-cm-mermaid";
    host.dataset.mkMermaidSource = this.source;
    if (this.caption) host.dataset.mkMermaidCaption = this.caption;
    const container = measuredBlockWidget(host, "media");

    const langLabel = document.createElement("span");
    langLabel.className = "mk-cm-mermaid-language";
    langLabel.textContent = "MERMAID";
    langLabel.setAttribute("aria-hidden", "true");
    host.append(langLabel);

    const actions = document.createElement("div");
    actions.className = "mk-cm-mermaid-actions";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "mk-cm-mermaid-copy";
    copyButton.dataset.tooltip = "复制 Mermaid 源码";
    copyButton.setAttribute("aria-label", "复制 Mermaid 源码");
    copyButton.innerHTML = COPY_ICON;
    const preventSelect = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    copyButton.addEventListener("pointerdown", preventSelect);
    copyButton.addEventListener("mousedown", preventSelect);
    copyButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyTextToClipboard(this.source, () => {
        copyButton.innerHTML = CHECK_ICON;
        copyButton.classList.add("mk-cm-mermaid-copy--ok");
        window.setTimeout(() => {
          copyButton.innerHTML = COPY_ICON;
          copyButton.classList.remove("mk-cm-mermaid-copy--ok");
        }, 1500);
      });
    });
    actions.append(copyButton);

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "mk-cm-mermaid-expand";
    previewButton.dataset.tooltip = "放大查看 Mermaid 图";
    previewButton.setAttribute("aria-label", "放大查看 Mermaid 图");
    previewButton.innerHTML = iconMarkup(Expand);
    previewButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const svg = host.querySelector(".mk-cm-mermaid-canvas svg")?.outerHTML;
      if (svg) requestMediaPreview({ src: svgDataUrl(svg), alt: "Mermaid 图表", title: "Mermaid 图表" });
    });
    actions.append(previewButton);

    if (this.editable) {
      const sourceButton = document.createElement("button");
      sourceButton.type = "button";
      sourceButton.className = "mk-cm-mermaid-source";
      sourceButton.dataset.tooltip = "编辑 Mermaid 源码";
      sourceButton.setAttribute("aria-label", "编辑 Mermaid 源码");
      sourceButton.innerHTML = iconMarkup(Code2);
      sourceButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({
          selection: { anchor: this.blockFrom },
          effects: editMermaidSourceEffect.of(this.blockFrom),
          scrollIntoView: true,
        });
        view.focus();
      });
      actions.append(sourceButton);
    }
    host.append(actions);

    const canvas = document.createElement("div");
    canvas.className = "mk-cm-mermaid-canvas";
    canvas.setAttribute("role", "region");
    canvas.style.userSelect = "text";
    canvas.addEventListener("pointerdown", (event) => {
      const target = event.target as Element | null;
      if (target?.closest("a, [role='link'], text, span, .node, .edgeLabel, .cluster-label")) {
        event.stopPropagation();
      }
    });
    canvas.addEventListener("click", (event) => {
      const link = (event.target as Element | null)?.closest("a");
      if (link && link.href) {
        event.stopPropagation();
      }
    });
    canvas.setAttribute("aria-label", "Mermaid 图表");
    host.append(canvas);

    if (this.caption) {
      const caption = document.createElement("div");
      caption.className = "mk-cm-mermaid-caption";
      caption.textContent = this.caption;
      host.append(caption);
    }

    const isDark = isDarkEditorView(view);
    const cached = getCachedMermaidSvg(this.source, isDark);
    if (cached) {
      canvas.innerHTML = cached.svg;
      return container;
    }

    // 若当前深浅色尚未缓存，但相反主题已有缓存，直接借用相反主题的 SVG 呈现在画布上！
    // 物理尺寸和 viewBox 分毫不差，高度绝对零坍缩，彻底杜绝切换主题时视口跳动与滚动重置。
    const peerCached = getCachedMermaidSvg(this.source, !isDark);
    if (peerCached) {
      canvas.innerHTML = peerCached.svg;
    } else {
      host.style.minHeight = "180px";
      host.dataset.state = "loading";
      canvas.textContent = "正在渲染图表…";
    }

    void renderMermaid(this.source, isDark)
      .then(({ svg }) => {
        // 容器可能已经被 CM 回收（用户快速滚动或改了源码），
        // 这时候往里写东西没有意义，isConnected 判掉。
        if (!canvas.isConnected) return;
        delete host.dataset.state;
        host.style.minHeight = "";
        canvas.innerHTML = svg;
        // 如果此前未命中任何缓存（从 loading 状态初次撑开），才需要通知 CM 重排测量；
        // 若此前已使用同尺寸的 peerCached，高度完全一致，避免冗余测量扰动视口。
        if (!peerCached) {
          view.requestMeasure();
        }
      })
      .catch((error: unknown) => {
        if (!canvas.isConnected) return;
        host.dataset.state = "error";
        host.style.minHeight = "";
        // 语法错误要给出原文，否则用户不知道图为什么画不出来。
        canvas.textContent = error instanceof Error ? error.message : "图表渲染失败";
        view.requestMeasure();
      });

    return container;
  }

  /**
   * 图表主体交给编辑器处理选区：普通单击仍是空选区并保持预览，
   * 拖选经过图表时才能让块级装饰恢复 Mermaid 源码。
   */
  override ignoreEvent(event: Event): boolean {
    const target = event.target as Element | null;
    if (target?.closest(".mk-cm-mermaid-canvas, .mk-cm-mermaid-source, a, [role='link']")) {
      return true;
    }
    return false;
  }
}
