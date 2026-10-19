// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentAvatarPicker } from "./agent-avatar-picker.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import type { AgentAvatar } from "@agent/protocol";

let root: Root | null = null;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });
async function mount(avatar: AgentAvatar) {
  const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  const onPresetChange = vi.fn(); const onIconChange = vi.fn(); const onFileChange = vi.fn();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><AgentAvatarPicker avatar={avatar} onPresetChange={onPresetChange} onIconChange={onIconChange} onFileChange={onFileChange} uploadError={null} /></TooltipProvider>); }));
  await act(() => Promise.resolve().then(() => { element.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!.click(); }));
  return { onPresetChange, onIconChange, onFileChange };
}
it("offers new character avatars and returns their stable preset identity", async () => {
  const { onPresetChange, onIconChange } = await mount({ kind: "icon", icon: "bot" });
  const fox = document.querySelector<HTMLButtonElement>('[role="option"][aria-label="小狐狸"]');
  expect(fox).not.toBeNull(); expect(fox?.querySelector('[data-avatar-preset="fox"]')).not.toBeNull();
  await act(() => Promise.resolve().then(() => { fox!.click(); }));
  expect(onPresetChange).toHaveBeenCalledExactlyOnceWith("fox"); expect(onIconChange).not.toHaveBeenCalled();
});
it("keeps the existing icon choices available after selecting a character", async () => {
  const { onIconChange } = await mount({ kind: "preset", preset: "fox" });
  expect(document.querySelector('[role="option"][aria-label="小狐狸"]')?.getAttribute("aria-selected")).toBe("true");
  const icons = document.querySelector<HTMLButtonElement>('button[aria-label="图标"]');
  expect(icons).not.toBeNull();
  await act(() => Promise.resolve().then(() => { icons!.click(); }));
  const code = document.querySelector<HTMLButtonElement>('[role="option"][title$="(code)"]');
  expect(code).not.toBeNull();
  await act(() => Promise.resolve().then(() => { code!.click(); }));
  expect(onIconChange).toHaveBeenCalledExactlyOnceWith("code");
});
it("preserves custom image upload alongside the built-in characters", async () => {
  const { onFileChange } = await mount({ kind: "image", dataUrl: "data:image/png;base64,fixture", fileName: "mine.png" });
  expect(document.querySelector('button[aria-label="Agent 头像：mine.png，点击选择"]')).not.toBeNull();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input.accept).toContain("image/png");
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["fixture"], "avatar.png", { type: "image/png" })] });
  await act(() => Promise.resolve().then(() => { input.dispatchEvent(new Event("change", { bubbles: true })); }));
  expect(onFileChange).toHaveBeenCalledTimes(1);
});
