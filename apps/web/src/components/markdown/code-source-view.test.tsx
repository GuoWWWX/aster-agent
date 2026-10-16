// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { CodeSourceView } from "./code-source-view.js";

let root: Root;
let mount: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = createRange();
    range.getClientRects = () => Object.assign([], { item: () => null });
    range.getBoundingClientRect = () => new DOMRect();
    return range;
  });
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
});
afterEach(() => {
  act(() => root.unmount()); mount.remove();
  useWorkbenchUiStore.setState({ themeMode: "light" });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const sources = [
  ["js", 'function sample() { return "中文"; }'],
  ["tsx", 'const sample = <div title="中文">Hello</div>;'],
  ["py", 'def sample(): return "中文"'],
  ["java", 'class Sample { String value = "中文"; }'],
  ["json", '{"sample": "中文", "enabled": true}'],
  ["css", '.sample { color: red; margin: 10px; }'],
  ["ps1", 'Write-Output "中文"'],
  ["bash", 'echo "中文"'],
] as const;

describe.each(["light", "dark"] as const)("virtual code highlighting in %s theme", themeMode => {
  it.each(sources)("loads %s syntax without expanding the entire document DOM", async (language, line) => {
    useWorkbenchUiStore.setState({ themeMode });
    act(() => root.render(<CodeSourceView source={`${line}\n`.repeat(1000)} language={language} />));
    await act(async () => {
      await vi.waitFor(() => expect(mount.querySelector(".cm-line span[class]")).not.toBeNull());
    });
    expect(mount.querySelectorAll(".cm-line").length).toBeLessThan(1000);
    const editor = EditorView.findFromDOM(mount.querySelector<HTMLElement>(".cm-editor")!);
    expect(editor?.state.facet(EditorView.darkTheme)).toBe(themeMode === "dark");
    expect(mount.querySelector("[contenteditable=true]")).toBeNull();
  });
});

it("keeps unknown language source readable without executing markup", () => {
  const source = '<script>alert("plain")</script>\n'.repeat(250);
  act(() => root.render(<CodeSourceView source={source} language="unknown-language" />));
  expect(mount.querySelector(".cm-line")?.textContent).toContain('<script>alert("plain")</script>');
  expect(mount.querySelector("script")).toBeNull();
});
