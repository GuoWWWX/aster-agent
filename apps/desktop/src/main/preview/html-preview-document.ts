import { Tokenizer } from "parse5";
import { HTML_PREVIEW_MAX_HEIGHT } from "@agent/protocol";

/** Add a size reporter without rewriting the authored document or its source view. */
export function htmlPreviewDocument(source: string, id: string): string {
  const { offset, hasDoctype } = previewDocumentPrefix(source);
  const reporter = `<script data-aster-preview-resize>(() => {
    if (window.parent === window) return;
    const id = ${JSON.stringify(id)};
    const maxHeight = ${HTML_PREVIEW_MAX_HEIGHT};
    let timer = 0, lastHeight = 0, viewportHeight = innerHeight, viewportWidth = innerWidth;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(measure, 50); };
    function measure() {
      const body = document.body, root = document.documentElement;
      if (!body || innerWidth === 0 || root.getBoundingClientRect().width === 0) return;
      // Viewport-sized roots must not cause a height -> viewport -> height loop.
      // Only override them while measuring natural content, then restore exactly.
      const saved = [root, body].flatMap(node => ['height', 'min-height'].map(property => ({
        node, property, value: node.style.getPropertyValue(property), priority: node.style.getPropertyPriority(property)
      })));
      for (const item of saved) item.node.style.setProperty(item.property, item.property === 'height' ? 'auto' : '0px', 'important');
      const rect = body.getBoundingClientRect(), bodyStyle = getComputedStyle(body), rootStyle = getComputedStyle(root);
      const number = value => parseFloat(value) || 0;
      const height = Math.min(maxHeight, Math.max(1, Math.ceil(Math.max(body.scrollHeight, body.offsetHeight, rect.height)
        + Math.max(0, rect.top + scrollY) + number(bodyStyle.marginBottom) + number(rootStyle.marginBottom)
        + number(rootStyle.paddingBottom) + number(rootStyle.borderBottomWidth))));
      for (const item of saved) {
        if (item.value) item.node.style.setProperty(item.property, item.value, item.priority);
        else item.node.style.removeProperty(item.property);
      }
      if (height !== lastHeight) { lastHeight = height; window.parent.postMessage({ type: 'html-preview.resize', id, height }, '*'); }
    }
    function start() {
      // CSS trigger #2: iframe documents cannot inherit the workbench scrollbar pseudo-elements.
      const scrollbar = document.createElement('style');
      scrollbar.textContent = '@layer aster-preview-defaults { :where(body) { display: flow-root; margin: 0; } }'
        + '* { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--app-muted-foreground, currentColor) 30%, transparent) transparent; }'
        + '*::-webkit-scrollbar { width: 10px; height: 10px; }'
        + '*::-webkit-scrollbar-track, *::-webkit-scrollbar-corner { background: transparent; }'
        + '*::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: color-mix(in srgb, var(--app-muted-foreground, currentColor) 30%, transparent); background-clip: padding-box; }'
        + '*::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--app-muted-foreground, currentColor) 58%, transparent); }'
        + '*::-webkit-scrollbar-thumb:active { background-color: color-mix(in srgb, var(--app-foreground, currentColor) 68%, transparent); }';
      // Contain child margins for natural measurement and avoid default margins overflowing 100vh.
      // Zero specificity and early placement let authored spacing and layout win.
      document.head.prepend(scrollbar);
      // Include root padding in viewport-sized boxes instead of adding it again.
      for (const node of [document.documentElement, document.body]) node.style.setProperty('box-sizing', 'border-box', 'important');
      const observer = new ResizeObserver(() => {
        if (viewportHeight !== innerHeight) { viewportHeight = innerHeight; return; }
        schedule();
      });
      observer.observe(document.body);
      new MutationObserver(records => {
        if (records.some(record => record.type !== 'attributes' || record.attributeName !== 'style'
          || (record.target !== document.body && record.target !== document.documentElement))) schedule();
      }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'width', 'height', 'hidden', 'open'] });
      window.addEventListener('resize', () => { if (viewportWidth !== innerWidth) { viewportWidth = innerWidth; schedule(); } });
      window.addEventListener('load', schedule, true);
      window.addEventListener('message', event => {
        if (event.source === window.parent && event.data?.type === 'html-preview.measure' && event.data.id === id) schedule();
      });
      document.fonts.ready.then(schedule);
      document.fonts.addEventListener('loadingdone', schedule);
      schedule();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  })();</script>`;
  // Quirks mode reports body.scrollHeight as at least the iframe viewport height,
  // which prevents short fragments from shrinking below the initial frame size.
  return (hasDoctype ? "" : "<!doctype html>\n") + source.slice(0, offset) + reporter + source.slice(offset);
}

/** Only the document prefix determines the insertion point; do not parse the entire page on Main. */
function previewDocumentPrefix(source: string): { offset: number; hasDoctype: boolean } {
  let offset = 0, initial = true, stopped = false, hasDoctype = false;
  const stop = (): void => { stopped = true; tokenizer.pause(); };
  const tokenizer = new Tokenizer({ sourceCodeLocationInfo: true }, {
    onComment() {}, onWhitespaceCharacter() {}, onEof() {},
    onDoctype(token) {
      if (stopped) return;
      if (initial) { offset = token.location?.endOffset ?? 0; hasDoctype = true; }
      initial = false;
    },
    onStartTag(token) {
      if (stopped) return;
      initial = false;
      if (token.tagName === "html") return;
      if (token.tagName === "head") offset = token.location?.endOffset ?? offset;
      stop();
    },
    onEndTag(token) {
      initial = false;
      if (["head", "body", "html", "br"].includes(token.tagName)) stop();
    },
    onCharacter: stop, onNullCharacter: stop,
  });
  tokenizer.write(source, true);
  return { offset, hasDoctype };
}
