// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipAnchor, TooltipProvider } from "./tooltip.js";
const portal = vi.hoisted(() => ({ current: undefined as HTMLElement | undefined }));
vi.mock("./native-overlay-provider.js", () => ({ useNativeOverlayContainer: () => portal.current }));

let root: Root;
let mount: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mount = document.createElement("div"); document.body.append(mount);
  root = createRoot(mount);
});
afterEach(() => { act(() => root.unmount()); portal.current = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });

function pointer(target: Element, type: string, relatedTarget: Element | null = null, clientX = 5, clientY = 5): void {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget, clientX, clientY });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  act(() => { target.dispatchEvent(event); });
}
function render(): HTMLButtonElement[] {
  act(() => { root.render(<TooltipProvider delayDuration={0}>
    <TooltipAnchor content="复制提示"><button>复制</button></TooltipAnchor>
    <TooltipAnchor content="分支提示"><button>分支</button></TooltipAnchor>
  </TooltipProvider>); });
  return [...mount.querySelectorAll("button")];
}
async function hover(target: Element): Promise<void> {
  pointer(target, "pointermove");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
it("closes on leaving a trigger without needing a subsequent pointer move or click", async () => {
  const [first, second] = render();
  await hover(first!);
  expect(document.querySelector("[role=tooltip]")?.textContent).toBe("复制提示");
  pointer(first!, "pointerout", second);
  expect(document.querySelector("[role=tooltip]")).toBeNull();
  await hover(second!);
  expect(document.querySelectorAll("[role=tooltip]")).toHaveLength(1);
  expect(document.querySelector("[role=tooltip]")?.textContent).toBe("分支提示");
  pointer(second!, "pointerout");
  expect(document.querySelector("[role=tooltip]")).toBeNull();
});
it("retains keyboard focus hints and dismisses on blur and Escape", () => {
  const [first, second] = render();
  act(() => first!.focus());
  expect(document.querySelector("[role=tooltip]")?.textContent).toBe("复制提示");
  act(() => second!.focus());
  expect(document.querySelectorAll("[role=tooltip]")).toHaveLength(1);
  expect(document.querySelector("[role=tooltip]")?.textContent).toBe("分支提示");
  act(() => { second!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(document.querySelector("[role=tooltip]")).toBeNull();
  act(() => { second!.blur(); first!.focus(); first!.blur(); });
  expect(document.querySelector("[role=tooltip]")).toBeNull();
});
it("dismisses when pointer movement leaves the trigger even if pointerleave was lost", async () => {
  const [first] = render();
  await hover(first!);
  expect(document.querySelector("[role=tooltip]")).not.toBeNull();
  pointer(document.body, "pointermove");
  expect(document.querySelector("[role=tooltip]")).toBeNull();
});
it("dismisses when the application window loses focus", async () => {
  const [first] = render();
  await hover(first!);
  act(() => { window.dispatchEvent(new FocusEvent("blur")); });
  expect(document.querySelector("[role=tooltip]")).toBeNull();
});
it("closes from native cursor updates when mouse events are consumed by another native view", async () => {
  const [first] = render();
  await hover(first!);
  vi.spyOn(first!, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 40, 30));
  const popup = document.querySelector<HTMLElement>('[data-native-view-overlay]')!;
  vi.spyOn(popup, "getBoundingClientRect").mockReturnValue(new DOMRect(60, 60, 120, 30));
  const cursor = (x: number, y: number): void => { act(() => { window.dispatchEvent(new CustomEvent("aster:native-tooltip-pointer", { detail: { x, y } })); }); };
  cursor(120, 110);
  cursor(120, 95);
  cursor(120, 75);
  expect(document.querySelector("[role=tooltip]")).not.toBeNull();
  cursor(400, 300);
  expect(document.querySelector("[role=tooltip]")).toBeNull();
});
it.each([false, true])("stays over its popup and closes when leaving both surfaces (native portal: %s)", async (native) => {
  const iframe = document.createElement("iframe");
  if (native) { document.body.append(iframe); portal.current = iframe.contentDocument!.body; }
  const [first] = render();
  await hover(first!);
  const owner = native ? iframe.contentDocument! : document;
  const content = owner.querySelector("[data-native-view-overlay]")!;
  pointer(first!, "pointerout", content);
  pointer(content, "pointermove");
  expect(owner.querySelectorAll("[role=tooltip]")).toHaveLength(1);
  pointer(content, "pointerout", owner.body);
  expect(owner.querySelector("[role=tooltip]")).toBeNull();
});
function ControlledTooltip() {
  const [open, setOpen] = useState(true);
  return <TooltipProvider><TooltipAnchor content="受控提示" open={open} onOpenChange={setOpen}><button>导航</button></TooltipAnchor></TooltipProvider>;
}
it.each([false, true])("allows crossing the gap, selecting popup text and leaving immediately (native portal: %s)", async (native) => {
  const iframe = document.createElement("iframe");
  if (native) { document.body.append(iframe); portal.current = iframe.contentDocument!.body; }
  const [first] = render();
  act(() => { first!.focus(); });
  await hover(first!);
  const owner = native ? iframe.contentDocument! : document;
  const content = owner.querySelector<HTMLElement>("[data-native-view-overlay]")!;
  vi.spyOn(first!, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 40, 30));
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue(new DOMRect(60, 60, 120, 30));
  pointer(first!, "pointerout", document.body, 120, 100);
  pointer(document.body, "pointermove", null, 120, 95);
  expect(owner.querySelector("[role=tooltip]")).not.toBeNull();
  pointer(content, "pointermove", null, 120, 75);
  expect(content.className).toContain("select-text");
  pointer(content, "pointerdown", null, 120, 75);
  expect(content.dataset.nativeOverlayInteractive).toBe("true");
  content.tabIndex = -1;
  act(() => { content.focus(); });
  expect(owner.querySelector("[role=tooltip]")).not.toBeNull();
  const selection = owner.getSelection()!;
  const range = owner.createRange(); range.selectNodeContents(owner.querySelector("[role=tooltip]")!);
  selection.removeAllRanges(); selection.addRange(range);
  expect(selection.toString()).toContain("复制提示");
  pointer(content, "pointerout", owner.body, 200, 75);
  expect(owner.querySelector("[role=tooltip]")).toBeNull();
});
it("also dismisses controlled navigation hints on window blur", () => {
  act(() => root.render(<ControlledTooltip />));
  expect(document.querySelector("[role=tooltip]")).not.toBeNull();
  act(() => { window.dispatchEvent(new FocusEvent("blur")); });
  expect(document.querySelector("[role=tooltip]")).toBeNull();
});
