// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "./dialog.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.js";

const native = vi.hoisted(() => ({ container: undefined as HTMLElement | undefined }));
vi.mock("./native-overlay-provider.js", () => ({ useNativeOverlayContainer: () => native.container }));
let root: Root;
let host: Window;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  const iframe = document.createElement("iframe"); document.body.append(iframe);
  host = iframe.contentWindow!;
  native.container = host.document.body;
  const mount = document.createElement("div"); document.body.append(mount);
  root = createRoot(mount);
  // A native popup has its own activeElement; it never becomes the opener's active element.
  vi.spyOn(document, "activeElement", "get").mockReturnValue(document.body);
});
afterEach(() => {
  act(() => root.unmount());
  native.container = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});
function Content({ ready = false, selectorOpen = false }: { ready?: boolean; selectorOpen?: boolean }): ReactElement {
  return <Dialog open><DialogContent aria-describedby={undefined}>
    <DialogTitle>Native dialog</DialogTitle>
    <button type="button" id="first">First action</button>
    <input aria-label="Preset name" />
    <button type="button">Other action</button>
    <div>{ready ? <img alt="Preview" /> : <span>Loading preview</span>}</div>
    <Select value="one" open={selectorOpen}><SelectTrigger aria-label="Theme"><SelectValue /></SelectTrigger><SelectContent position="item-aligned">{["one", "two", "three"].map(value => <SelectItem key={value} value={value} ref={node => { if (node) node.scrollIntoView = () => {}; }}>{value}</SelectItem>)}</SelectContent></Select>
  </DialogContent></Dialog>;
}
async function render(ready = false): Promise<void> {
  await act(async () => { root.render(<Content ready={ready} />); await new Promise(resolve => setTimeout(resolve, 0)); });
}
it("focuses the first popup control without walking through every control in the opener", async () => {
  await render();
  expect(host.document.activeElement?.id).toBe("first");
});
it("retains popup input focus when an asynchronous preview replaces its loading state", async () => {
  await render();
  const input = host.document.querySelector("input")!;
  act(() => input.focus());
  expect(host.document.activeElement).toBe(input);
  await render(true);
  expect(host.document.activeElement).toBe(input);
});
it("moves a native popup selector to the next option rather than the final option", async () => {
  await render();
  await act(async () => { root.render(<Content selectorOpen />); await new Promise(resolve => setTimeout(resolve, 0)); });
  await vi.waitFor(() => expect(host.document.activeElement?.textContent).toBe("one"));
  act(() => { host.document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  await vi.waitFor(() => expect(host.document.activeElement?.textContent).toBe("two"));
});
