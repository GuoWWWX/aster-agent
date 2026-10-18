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
  });
  it("saves the real application grant before user startup and can revoke it", async () => {
    const f = await fixture(); vi.spyOn(f.client, "chooseComputerApplication").mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", name: "记事本", executablePath: "C:\\Windows\\notepad.exe", enabled: true });
    await act(async () => { f.checkbox("启用电脑控制").click(); await Promise.resolve(); });
    await act(async () => { f.button("添加软件").click(); await Promise.resolve(); });
    expect(f.container.textContent).toContain("C:\\Windows\\notepad.exe");
    await act(async () => { f.button("启动控制").click(); await Promise.resolve(); });
    expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, applications: [expect.objectContaining({ name: "记事本" })] }));
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
    expect(f.save).toHaveBeenCalledWith({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, enabled: true, administrator: true });
    expect(f.container.textContent).toContain("管理员启动被取消"); expect(f.container.textContent).toContain("未启动");
  });
});
