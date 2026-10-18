// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COMPUTER_USE_CONFIGURATION } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { ComputerUseSettings } from "./computer-use-settings.js";
let root: Root | undefined;
beforeEach(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); });
async function fixture() {
  const client = new MockAgentClient();
  vi.spyOn(client, "getComputerUseStatus").mockResolvedValue({ supported: true, running: false, elevated: false });
  const save = vi.spyOn(client, "saveComputerUseConfiguration");
  const start = vi.spyOn(client, "startComputerUse").mockResolvedValue({ supported: true, running: true, elevated: false });
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<TooltipProvider><ComputerUseSettings agentClient={client} /></TooltipProvider>); await Promise.resolve(); });
  const checkbox = (label: string) => { const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`); if (!input) throw new Error(label); return input; };
  const button = (label: string) => { const result = [...container.querySelectorAll("button")].find((value) => value.textContent === label || value.getAttribute("aria-label") === label); if (!result) throw new Error(label); return result; };
  return { client, container, save, start, checkbox, button };
}
describe("ComputerUseSettings", () => {
  it("loads defaults without writing configuration or starting a helper", async () => {
    const f = await fixture(); expect(f.checkbox("启用电脑控制").checked).toBe(false);
    expect(f.container.textContent).toContain("尚未授权任何软件"); expect(f.save).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    expect(f.container.textContent).toContain("按 Esc 立即退出");
  });
  it("saves the real application grant before user startup and can revoke it", async () => {
    const f = await fixture(); vi.spyOn(f.client, "chooseComputerApplication").mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", name: "记事本", executablePath: "C:\\Windows\\notepad.exe", enabled: true });
    await act(async () => { f.checkbox("启用电脑控制").click(); await Promise.resolve(); });
    await act(async () => { f.button("添加软件").click(); await Promise.resolve(); });
    expect(f.container.textContent).toContain("C:\\Windows\\notepad.exe");
    await act(async () => { f.button("启动控制").click(); await Promise.resolve(); });
    expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, applications: [expect.objectContaining({ name: "记事本" })] }), expect.any(Array));
    expect(f.start).toHaveBeenCalledOnce(); expect(f.container.textContent).toContain("运行中 · 普通权限");
    await act(async () => { f.button("移除 记事本 的授权").click(); await new Promise((resolve) => setTimeout(resolve, 500)); });
    expect((await f.client.getComputerUseConfiguration()).applications).toEqual([]);
  });
  it("does not claim administrator access when Windows startup fails", async () => {
    const f = await fixture(); f.start.mockRejectedValue(new Error("管理员启动被取消"));
    await act(async () => { f.checkbox("启用电脑控制").click(); await Promise.resolve(); });
    await act(async () => { f.checkbox("管理员模式").click(); await Promise.resolve(); });
    expect(f.start).not.toHaveBeenCalled();
    await act(async () => { f.button("启动控制").click(); await Promise.resolve(); });
    expect(f.save).toHaveBeenCalledWith({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, enabled: true, administrator: true }, expect.any(Array));
    expect(f.container.textContent).toContain("管理员启动被取消"); expect(f.container.textContent).toContain("未启动");
  });
  it("manages a blacklist independently of administrator mode and displays the executable icon", async () => {
    const f = await fixture();
    const application = { id: "11111111-1111-4111-8111-111111111111", name: "记事本", executablePath: "C:\\Windows\\notepad.exe", enabled: true };
    vi.spyOn(f.client, "chooseComputerApplication").mockResolvedValue(application);
    vi.spyOn(f.client, "getComputerUseApplicationIcons").mockResolvedValue({ [application.id]: "data:image/png;base64,aGVsbG8=" });
    await act(async () => { f.button("添加黑名单").click(); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
    expect((await f.client.getComputerUseConfiguration()).blockedApplications).toEqual([application]);
    expect(f.container.querySelector('img[src="data:image/png;base64,aGVsbG8="]')).not.toBeNull();
    expect(f.checkbox("禁止控制 记事本").checked).toBe(true); expect(f.checkbox("管理员模式").checked).toBe(false);
    await act(async () => { f.button("从黑名单移除 记事本").click(); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
    expect((await f.client.getComputerUseConfiguration()).blockedApplications).toEqual([]);
  });
  it("refreshes grants approved during control without overwriting an unsaved local edit", async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture();
      const application = { id: "11111111-1111-4111-8111-111111111111", name: "永久批准的软件", executablePath: "C:\\Editor.exe", enabled: true };
      vi.spyOn(f.client, "getComputerUseConfiguration").mockResolvedValue({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, accessMode: "all", applications: [application] });
      await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
      expect(f.container.textContent).toContain("永久批准的软件"); expect(f.container.textContent).toContain("允许所有软件"); expect(f.save).not.toHaveBeenCalled();
      await act(async () => { f.checkbox("管理员模式").click(); await vi.advanceTimersByTimeAsync(300); });
      expect(f.checkbox("管理员模式").checked).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("preserves a newly approved permanent grant when the user edits settings before the next refresh", async () => {
    const f = await fixture();
    const application = { id: "11111111-1111-4111-8111-111111111111", name: "刚批准的软件", executablePath: "C:\\Editor.exe", enabled: true };
    await f.client.saveComputerUseConfiguration({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, applications: [application] });
    await act(async () => { f.checkbox("管理员模式").click(); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
    expect((await f.client.getComputerUseConfiguration()).applications).toEqual([application]);
    expect(f.container.textContent).toContain("刚批准的软件");
  });
});
