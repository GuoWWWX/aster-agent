// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { normalizeMermaidThemes, type MermaidThemeSettings } from "../../../lib/mermaid-theme-settings.js";
import { MermaidThemePreview } from "./mermaid-theme-preview.js";
import { MermaidThemePresets } from "./mermaid-theme-presets.js";
import { Dialog } from "../../../components/ui/dialog.js";
import { MermaidThemeDialog } from "./mermaid-theme-settings.js";

const renderMermaid = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/mermaid.js", () => ({ renderMermaid }));
let root: Root;
let mount: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
  renderMermaid.mockReset().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>preview</text></svg>' });
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
async function renderPreview(settings: MermaidThemeSettings): Promise<void> {
  await act(async () => {
    root.render(<MermaidThemePreview type="flowchart" dark={false} settings={settings} />);
    await Promise.resolve();
  });
}

it("does not redraw when only saved presets or another diagram's overrides change", async () => {
  const settings = normalizeMermaidThemes();
  await renderPreview(settings);
  expect(renderMermaid).toHaveBeenCalledTimes(1);
  const updated = normalizeMermaidThemes({ ...settings, dark: "forest", diagrams: { sequence: { light: "neo" } }, presets: [{ name: "组合", light: "neo", dark: "neo-dark", diagrams: {} }] });
  await renderPreview(updated);
  expect(renderMermaid).toHaveBeenCalledTimes(1);
  await renderPreview(normalizeMermaidThemes({ ...updated, light: "forest" }));
  expect(renderMermaid).toHaveBeenCalledTimes(2);
  expect(mount.querySelector('[aria-busy="false"]')).not.toBeNull();
});

it("keeps a late render from replacing the preview for the current theme", async () => {
  let finishFirst!: (value: { svg: string }) => void;
  renderMermaid.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
  await renderPreview(normalizeMermaidThemes());
  expect(mount.querySelector('[aria-busy="true"]')).not.toBeNull();
  await renderPreview(normalizeMermaidThemes({ light: "forest" }));
  const image = mount.querySelector("img")!.src;
  await act(async () => { finishFirst({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>old</text></svg>' }); await Promise.resolve(); });
  expect(mount.querySelector("img")!.src).toBe(image);
  expect(mount.textContent).toContain("Forest");
});

it("shows the upstream palette swatches and updates the selected pair", () => {
  const onChange = vi.fn();
  act(() => root.render(<MermaidThemePresets light="redux-color" dark="redux-dark-color" onChange={onChange} />));
  const choices = [...mount.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
  expect(choices).toHaveLength(4);
  expect(mount.querySelectorAll("[data-mermaid-color-swatch]")).toHaveLength(16);
  expect(choices[0]?.getAttribute("aria-pressed")).toBe("true");
  act(() => choices[1]!.click());
  expect(onChange).toHaveBeenCalledWith({ light: "redux", dark: "redux-dark" });
});

it("offers all themes on opening a lazy selector and redraws only the changed appearance", async () => {
  const onApply = vi.fn();
  await act(async () => { root.render(<Dialog open><MermaidThemeDialog value={normalizeMermaidThemes()} onApply={onApply} onCancel={vi.fn()} /></Dialog>); await Promise.resolve(); });
  expect(renderMermaid).toHaveBeenCalledTimes(2);
  const select = document.querySelector<HTMLButtonElement>('[aria-label="浅色默认主题"]')!;
  act(() => { select.focus(); select.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  await vi.waitFor(() => expect(document.querySelectorAll('[role="option"]')).toHaveLength(11));
  const forest = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(element => element.textContent === "Forest")!;
  await act(async () => { forest.focus(); forest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await Promise.resolve(); });
  expect(renderMermaid).toHaveBeenCalledTimes(3);
  const apply = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "应用配置")!;
  act(() => apply.click());
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ light: "forest", dark: "redux-dark-color" }));
});
