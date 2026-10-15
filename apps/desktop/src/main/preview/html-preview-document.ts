import { parse } from "parse5";
import { HTML_PREVIEW_MAX_HEIGHT } from "@agent/protocol";

/** Add a size reporter without rewriting the authored document or its source view. */
export function htmlPreviewDocument(source: string, id: string): string {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const html = document.childNodes.find(node => "tagName" in node && node.tagName === "html");
  const head = html && "childNodes" in html ? html.childNodes.find(node => "tagName" in node && node.tagName === "head") : undefined;
  const doctype = document.childNodes.find(node => node.nodeName === "#documentType");
  const offset = head && "tagName" in head ? head.sourceCodeLocation?.startTag?.endOffset ?? doctype?.sourceCodeLocation?.endOffset ?? 0
    : doctype?.sourceCodeLocation?.endOffset ?? 0;
  const reporter = `<script data-aster-preview-resize>(() => {
    if (window.parent === window) return;
    const id = ${JSON.stringify(id)};
    const maxHeight = ${HTML_PREVIEW_MAX_HEIGHT};
    let timer = 0, lastHeight = 0, viewportHeight = innerHeight, viewportWidth = innerWidth;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(measure, 50); };
    function measure() {
      const body = document.body, root = document.documentElement;
      if (!body) return;
      // Viewport-sized roots must not cause a height -> viewport -> height loop.
      // Only override them while measuring natural content, then restore exactly.
      const saved = [root, body].flatMap(node => ['height', 'min-height'].map(property => ({
        node, property, value: node.style.getPropertyValue(property), priority: node.style.getPropertyPriority(property)
      })));
      for (const item of saved) item.node.style.setProperty(item.property, item.property === 'height' ? 'auto' : '0px', 'important');
      const rect = body.getBoundingClientRect(), bodyStyle = getComputedStyle(body), rootStyle = getComputedStyle(root);
      const number = value => parseFloat(value) || 0;
      const height = Math.min(maxHeight, Math.max(1, Math.ceil(Math.max(body.scrollHeight, body.offsetHeight, rect.height)
        + Math.max(0, rect.top + scrollY) + number(bodyStyle.marginBottom) + number(rootStyle.paddingBottom) + number(rootStyle.borderBottomWidth))));
      for (const item of saved) {
        if (item.value) item.node.style.setProperty(item.property, item.value, item.priority);
        else item.node.style.removeProperty(item.property);
      }
      if (height !== lastHeight) { lastHeight = height; window.parent.postMessage({ type: 'html-preview.resize', id, height }, '*'); }
    }
    function start() {
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
  return source.slice(0, offset) + reporter + source.slice(offset);
}
