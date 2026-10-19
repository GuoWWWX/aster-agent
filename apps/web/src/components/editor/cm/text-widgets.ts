import { COPY_ICON, CHECK_ICON } from "./widget-dom.js";
import { EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";
import { orderedListMarker } from "./source-indent.js";
import { normalizeMathSource } from "../../../lib/markdown-math.js";
import { copyTextToClipboard } from "./widget-dom.js";



/** KaTeX 公式预览；点击公式时把光标放回源码，保持实时预览可编辑。 */
export class MarkdownMathWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly display: boolean,
    private readonly editPosition: number,
    private readonly editable: boolean,
  ) {
    super();
  }

  override eq(other: MarkdownMathWidget): boolean {
    return other.source === this.source
      && other.display === this.display
      && other.editPosition === this.editPosition
      && other.editable === this.editable;
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = document.createElement(this.display ? "div" : "span");
    host.className = this.display ? "mk-cm-math-block" : "mk-cm-math-inline";
    const normalized = normalizeMathSource(this.source);
    try {
      host.innerHTML = katex.renderToString(normalized, {
        displayMode: this.display,
        throwOnError: true,
        output: "html",
        strict: false,
        trust: false,
      });
    } catch {
      host.classList.add("is-invalid");
      host.textContent = this.source;
    }
    if (this.editable) {
      host.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({ selection: { anchor: this.editPosition }, scrollIntoView: true });
        view.focus();
      });
    }
    return host;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

export class MarkdownBreakWidget extends WidgetType {
  override eq(other: MarkdownBreakWidget) { return other.constructor === MarkdownBreakWidget; }
  override toDOM() { const element = document.createElement("br"); element.className = "mk-cm-markdown-break"; return element; }
  override ignoreEvent() { return false; }
}

/**
 * 代码块右上角的复制按钮。
 *
 * 放在围栏首行末尾（side:1 widget），绝对定位浮在右上角；
 * 点击后图标短暂切换成对勾再还原，给用户明确的操作反馈。
 */
export class CopyCodeWidget extends WidgetType {
  constructor(private readonly code: string) {
    super();
  }

  override eq(other: CopyCodeWidget): boolean {
    return other.code === this.code;
  }

  override toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mk-cm-copy-code";
    btn.setAttribute("aria-label", "复制代码");
    btn.dataset.tooltip = "复制代码";
    btn.innerHTML = COPY_ICON;

    // 在 click 之前阻止编辑器移动选区和按钮抢焦点，避免围栏切换到源码态。
    const keepEditorSelection = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    btn.addEventListener("pointerdown", keepEditorSelection);
    btn.addEventListener("mousedown", keepEditorSelection);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyTextToClipboard(this.code, () => {
        btn.innerHTML = CHECK_ICON;
        btn.classList.add("mk-cm-copy-code--ok");
        window.setTimeout(() => {
          btn.innerHTML = COPY_ICON;
          btn.classList.remove("mk-cm-copy-code--ok");
        }, 1500);
      });
    });

    return btn;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * 无序列表的排版化圆点。
 *
 * 源码里的 `-` / `*` / `+` 在渲染态被 replace 成这个 widget，
 * 用真正的圆点字符而不是保留原字符，才能和 Word 预览侧的列表观感对齐。
 *
 * eq() 必须实现：CM 每次 update 都会拿新 widget 和旧 widget 比对，
 * 返回 true 时复用现有 DOM。不实现的话默认恒为 false，
 * 滚动或输入时每个圆点都被销毁重建，表现为整段列表闪烁。
 */
export class BulletWidget extends WidgetType {
  constructor(private readonly depth: number) {
    super();
  }

  override eq(other: BulletWidget): boolean {
    return other.depth === this.depth;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "mk-cm-bullet";
    // 按嵌套层级换符号，和常见 Markdown 渲染器（含本项目 Word 预览）的层级约定一致。
    span.textContent = `${this.depth % 3 === 0 ? "•" : this.depth % 3 === 1 ? "◦" : "▪"} `;
    // 屏幕阅读器不该念出这个纯装饰字符，源码里的 `-` 才是语义所在。
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  /** 圆点是纯展示，不吞事件——让点击照常落到编辑器上定位光标。 */
  override ignoreEvent(): boolean {
    return false;
  }
}

export class OrderedListWidget extends WidgetType {
  constructor(private readonly sourceMarker: string, private readonly value: number) {
    super();
  }

  override eq(other: OrderedListWidget): boolean {
    return other.sourceMarker === this.sourceMarker && other.value === this.value;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "mk-cm-ordered-marker";
    span.textContent = `${orderedListMarker(this.sourceMarker, this.value)} `;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * GFM 任务列表的可视复选框。
 *
 * 源码仍保留在文档中，只有光标靠近标记时才由实时预览层替换成此 widget；
 * 因此既能一眼识别任务状态，也不会引入另一份脱离 Markdown 的状态。
 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  override toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement("span");
    checkbox.className = "mk-cm-task-checkbox";
    checkbox.dataset.checked = String(this.checked);
    checkbox.setAttribute("role", "checkbox");
    checkbox.setAttribute("aria-checked", String(this.checked));
    checkbox.setAttribute("aria-label", this.checked ? "取消完成状态" : "标记为已完成");
    checkbox.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const markerStart = view.posAtDOM(checkbox, 0);
      const marker = view.state.doc.sliceString(markerStart, markerStart + 3);
      if (!/^\[(?: |x|X)\]$/.test(marker)) return;

      view.dispatch({
        changes: { from: markerStart + 1, to: markerStart + 2, insert: this.checked ? " " : "x" },
        scrollIntoView: false,
      });
      view.focus();
    });
    return checkbox;
  }

  /** 任务标记附近仍允许编辑器处理光标，进入源码态后可以直接修改 `[ ]` / `[x]`。 */
  override ignoreEvent(): boolean {
    return true;
  }
}
