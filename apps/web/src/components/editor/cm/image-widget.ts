import { EditorView, WidgetType } from "@codemirror/view";
import {
  AlignCenter,
  AlignJustify,
  Code2,
  Maximize2,
} from "lucide-react";
import { requestMediaPreview } from "../../media/image-viewer.js";
import { resolvePreviewImageSource } from "./image-source-resolver.js";
import { measuredBlockWidget, iconMarkup } from "./widget-dom.js";

type ImageWidthMode = "fit" | "natural";

const imageWidthModes = new Map<string, ImageWidthMode>();

/** 独占一行的 Markdown 图片在编辑器内按块级预览，源码可通过右上角按钮恢复编辑。 */
export class MarkdownImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
    private readonly markdownSourcePath: string | undefined,
    private readonly blockFrom: number,
    private readonly blockTo: number,
    private readonly selected: boolean,
    private readonly editable: boolean,
  ) {
    super();
  }

  override eq(other: MarkdownImageWidget): boolean {
    return this.hasSameImage(other)
      && other.selected === this.selected;
  }

  override updateDOM(dom: HTMLElement, _view: EditorView, previous: MarkdownImageWidget): boolean {
    if (!this.hasSameImage(previous)) return false;
    // 选中或取消选中时只切换外框。重建大图片会先回退到加载占位高度，
    // 随后 load/requestMeasure 再撑开，表现为整个编辑页跳动闪烁。
    const host = dom.classList.contains("mk-cm-image")
      ? dom
      : dom.querySelector<HTMLElement>(".mk-cm-image");
    if (!host) return false;
    host.dataset.selected = String(this.selected);
    return true;
  }

  private hasSameImage(other: MarkdownImageWidget): boolean {
    return other.src === this.src
      && other.alt === this.alt
      && other.markdownSourcePath === this.markdownSourcePath
      && other.blockFrom === this.blockFrom
      && other.blockTo === this.blockTo
      && other.editable === this.editable;
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("div");
    host.className = "mk-cm-image";
    host.dataset.state = "loading";
    host.dataset.selected = String(this.selected);
    const container = measuredBlockWidget(host, "media");
    host.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    const frame = document.createElement("div");
    frame.className = "mk-cm-image-frame";
    host.append(frame);

    const canvas = document.createElement("div");
    canvas.className = "mk-cm-image-canvas";
    canvas.textContent = "正在加载图片…";
    frame.append(canvas);

    const widthModeKey = `${this.markdownSourcePath ?? "untitled"}\u0000${this.src}`;
    let widthMode = imageWidthModes.get(widthModeKey) ?? "natural";
    const applyWidthMode = (next: ImageWidthMode) => {
      widthMode = next;
      imageWidthModes.set(widthModeKey, next);
      host.dataset.widthMode = next;
    };
    applyWidthMode(widthMode);
    if (this.editable) {
      const showSource = () => {
        view.dispatch({
          selection: { anchor: this.blockFrom },
          scrollIntoView: true,
        });
        view.focus();
      };
      const focusAfterImage = () => {
        const afterImage = this.blockTo + 1;
        const hasNextLine = this.blockTo < view.state.doc.length
          && view.state.doc.sliceString(this.blockTo, afterImage) === "\n";
        view.dispatch(
          hasNextLine
            ? { selection: { anchor: afterImage }, scrollIntoView: true }
            : { changes: { from: this.blockTo, insert: "\n" }, selection: { anchor: afterImage }, scrollIntoView: true },
        );
        view.focus();
      };
      const sourceButton = document.createElement("button");
      sourceButton.type = "button";
      sourceButton.className = "mk-cm-image-source";
      sourceButton.dataset.tooltip = "编辑图片 Markdown";
      sourceButton.setAttribute("aria-label", "编辑图片 Markdown");
      sourceButton.innerHTML = iconMarkup(Code2);
      sourceButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showSource();
      });
      frame.append(sourceButton);

      const widthButton = document.createElement("button");
      widthButton.type = "button";
      widthButton.className = "mk-cm-image-width";
      const syncWidthButton = () => {
        const nextLabel = widthMode === "fit" ? "切换为原始宽度" : "切换为适应窗口宽度";
        widthButton.dataset.tooltip = nextLabel;
        widthButton.setAttribute("aria-label", nextLabel);
        widthButton.innerHTML = iconMarkup(widthMode === "fit" ? AlignCenter : AlignJustify);
      };
      syncWidthButton();
      widthButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyWidthMode(widthMode === "fit" ? "natural" : "fit");
        syncWidthButton();
        view.requestMeasure();
      });
      frame.append(widthButton);

      const continuation = document.createElement("div");
      continuation.className = "mk-cm-image-continuation";
      continuation.setAttribute("role", "button");
      continuation.setAttribute("aria-label", "在图片后继续输入");
      continuation.tabIndex = 0;
      continuation.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        focusAfterImage();
      });
      continuation.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        focusAfterImage();
      });
      host.append(continuation);
    }

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "mk-cm-image-expand";
    previewButton.dataset.tooltip = "放大查看图片";
    previewButton.setAttribute("aria-label", "放大查看图片");
    previewButton.innerHTML = iconMarkup(Maximize2);
    frame.append(previewButton);

    void resolvePreviewImageSource(this.src, this.markdownSourcePath)
      .then((resolvedSrc) => {
        if (!host.isConnected || !resolvedSrc) throw new Error("图片无法预览");
        const image = document.createElement("img");
        image.src = resolvedSrc;
        image.alt = this.alt;
        image.addEventListener("load", () => view.requestMeasure());
        if (this.editable) {
          image.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            view.dispatch({
              selection: { anchor: this.blockFrom, head: this.blockTo },
            });
            view.focus();
          });
        }
        previewButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          requestMediaPreview({ src: resolvedSrc, alt: this.alt, title: this.alt || "图片预览" });
        });
        canvas.replaceChildren(image);
        delete host.dataset.state;
        view.requestMeasure();
      })
      .catch(() => {
        if (!host.isConnected) return;
        host.dataset.state = "error";
        canvas.textContent = "图片无法预览";
        previewButton.disabled = true;
        view.requestMeasure();
      });

    return container;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}
