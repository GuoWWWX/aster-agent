// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const renderer = vi.hoisted(() => ({ render: vi.fn(), cached: vi.fn() }));
vi.mock("../../../lib/mermaid.js", () => ({ renderMermaid: renderer.render, getCachedMermaidSvg: renderer.cached }));
import { refreshLiveMermaidTheme } from "./mermaid-widget.js";

afterEach(() => { document.body.replaceChildren(); vi.resetAllMocks(); });

it("keeps the latest selected theme when an earlier drawing resolves later", async () => {
  document.body.innerHTML = '<div class="mk-cm-mermaid" data-mk-mermaid-source="flowchart LR"><div class="mk-cm-mermaid-canvas"><svg data-theme="initial"></svg></div></div>';
  let resolveEarlier: (value: { svg: string }) => void = () => undefined;
  let resolveLatest: (value: { svg: string }) => void = () => undefined;
  renderer.render.mockReturnValueOnce(new Promise(resolve => { resolveEarlier = resolve; }))
    .mockReturnValueOnce(new Promise(resolve => { resolveLatest = resolve; }));
  refreshLiveMermaidTheme(document.body, false);
  refreshLiveMermaidTheme(document.body, true);
  expect(document.querySelector('[data-theme="initial"]')).not.toBeNull();
  resolveLatest({ svg: '<svg data-theme="latest"></svg>' });
  await Promise.resolve();
  resolveEarlier({ svg: '<svg data-theme="earlier"></svg>' });
  await Promise.resolve();
  expect(document.querySelector('[data-theme="latest"]')).not.toBeNull();
  expect(document.querySelector('[data-theme="earlier"]')).toBeNull();
});
