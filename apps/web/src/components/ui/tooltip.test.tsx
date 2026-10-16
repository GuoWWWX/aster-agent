// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipAnchor, TooltipProvider } from "./tooltip.js";

let root: Root;
let mount: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mount = document.createElement("div"); document.body.append(mount);
  root = createRoot(mount);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

function pointer(target: Element, type: string, relatedTarget: Element | null = null): void {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget, clientX: 5, clientY: 5 });
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
