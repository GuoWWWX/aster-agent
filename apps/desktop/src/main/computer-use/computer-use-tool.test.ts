import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMPUTER_USE_CONFIGURATION, type ComputerUseConfiguration } from "@agent/protocol";
import { ComputerUseTool } from "./computer-use-tool.js";
import type { ComputerControlPort } from "./windows-computer-controller.js";
import { toolsForAgentRole } from "../agent/agent-tool-scope.js";
const id = "11111111-1111-4111-8111-111111111111";
function fixture() {
  let configuration: ComputerUseConfiguration = { ...structuredClone(DEFAULT_COMPUTER_USE_CONFIGURATION), enabled: true, applications: [{ id, name: "编辑器", executablePath: "C:\\Editor.exe", enabled: true }] };
  const execute = vi.fn<ComputerControlPort["execute"]>().mockResolvedValue({ ok: true, value: { performed: true } });
  const controller: ComputerControlPort = { getStatus: () => ({ supported: true, running: true, elevated: false }), start: vi.fn(), stop: vi.fn(), execute };
  const tool = new ComputerUseTool(controller, { getConfiguration: () => configuration });
  return { tool, execute, set: (next: Partial<ComputerUseConfiguration>) => { configuration = { ...configuration, ...next }; } };
}
describe("computer use tool", () => {
  it("is absent by default and excluded from coordinator/lead roles", async () => {
    const f = fixture(); f.set({ enabled: false });
    expect(f.tool.getDefinitions()).toEqual([]);
    expect(await f.tool.execute('{"action":"list"}', new AbortController().signal)).toMatchObject({ isError: true });
    expect(f.execute).not.toHaveBeenCalled();
    for (const role of ["quick_coordinator", "team_coordinator", "team_lead"] as const) expect(toolsForAgentRole(role)?.has("computer_use")).toBe(false);
    expect(toolsForAgentRole("subagent")?.has("computer_use")).toBe(true);
  });
  it.each(["click", "type", "key", "scroll", "launch", "start", "focus", "move", "drag", "paste", "sequence"])("prepares %s without any input before approval", async (action) => {
    const f = fixture();
    const commands = { click: { windowId: "123", x: 1, y: 2 }, type: { windowId: "123", text: "a" }, key: { windowId: "123", key: "Tab" }, scroll: { windowId: "123", delta: -1 }, launch: { applicationId: id }, start: {},
      focus: { windowId: "123" }, move: { windowId: "123", x: 1, y: 2 }, drag: { windowId: "123", path: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
      paste: { windowId: "123", text: "中文" }, sequence: { windowId: "123", steps: [{ action: "key", key: "Enter" }] } };
    const command = { action, ...commands[action as keyof typeof commands] };
    const prepared = await f.tool.execute(JSON.stringify(command), new AbortController().signal);
    expect(f.execute).not.toHaveBeenCalled();
    expect(prepared.kind).toBe("approved_action");
    if (prepared.kind !== "approved_action") throw new Error("Expected approval");
    expect(prepared.action.permissionTool).toBe("computer_use");
    await prepared.action.execute(); expect(f.execute).toHaveBeenCalledOnce();
  });
  it("offers startup and reuses run_command for opening software", async () => {
    const f = fixture(); const description = f.tool.getDefinitions()[0]!.description;
    expect(description).toContain("run_command"); expect(description).not.toContain("only be started by the user");
    for (const action of ["status", "stop"]) expect(await f.tool.execute(JSON.stringify({ action }), new AbortController().signal)).toMatchObject({ kind: "completed", isError: false });
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it("rechecks revocation and cancellation after waiting for approval", async () => {
    const f = fixture(); const abort = new AbortController();
    const prepared = await f.tool.execute('{"action":"type","windowId":"123","text":"hello"}', abort.signal);
    if (prepared.kind !== "approved_action") throw new Error("Expected approval");
    f.set({ enabled: false }); expect(await prepared.action.execute()).toMatchObject({ isError: true }); expect(f.execute).not.toHaveBeenCalled();
    abort.abort(); await expect(prepared.action.execute()).rejects.toThrow(); expect(f.execute).not.toHaveBeenCalled();
  });
  it("returns bounded actionable denial and model vision screenshot without inline base64 text", async () => {
    const f = fixture(); f.execute.mockResolvedValueOnce({ ok: false, code: "APPLICATION_NOT_ALLOWED" });
    const denied = await f.tool.execute('{"action":"observe","windowId":"123"}', new AbortController().signal);
    expect(denied).toMatchObject({ isError: true }); expect(JSON.parse(denied.content)).toMatchObject({ code: "APPLICATION_NOT_ALLOWED" });
    f.execute.mockResolvedValueOnce({ ok: true, value: { data: "aGVsbG8=", width: 100, height: 200 } });
    const screenshot = await f.tool.execute('{"action":"screenshot","windowId":"123"}', new AbortController().signal);
    expect(screenshot).toMatchObject({ isError: false, modelAttachments: [expect.objectContaining({ source: "computer", data: "aGVsbG8=" })] });
    expect(screenshot.content).not.toContain("aGVsbG8=");
  });
  it("does not fall back to shell execution or retry a failed side effect", async () => {
    const f = fixture(); f.execute.mockResolvedValue({ ok: false, code: "INPUT_BLOCKED" });
    const prepared = await f.tool.execute('{"action":"click","windowId":"123","x":1,"y":2}', new AbortController().signal);
    if (prepared.kind !== "approved_action") throw new Error("Expected approval");
    expect(await prepared.action.execute()).toMatchObject({ isError: true }); expect(f.execute).toHaveBeenCalledOnce();
    await expect(f.tool.execute('{"action":"shell","command":"whoami"}', new AbortController().signal)).rejects.toThrow();
  });
  it("validates the whole sequence before approval and preserves partial failure progress", async () => {
    const f = fixture();
    await expect(f.tool.execute(JSON.stringify({ action: "sequence", windowId: "123", steps: [
      { action: "click", x: 1, y: 2 }, { action: "key", key: "not-a-key" },
    ] }), new AbortController().signal)).rejects.toThrow();
    expect(f.execute).not.toHaveBeenCalled();
    f.execute.mockResolvedValue({ ok: false, code: "WINDOW_OCCLUDED", completedSteps: 1, failedStep: 2 });
    const prepared = await f.tool.execute(JSON.stringify({ action: "sequence", windowId: "123", steps: [
      { action: "move", x: 1, y: 2 }, { action: "scroll", delta: 1, axis: "horizontal" },
    ] }), new AbortController().signal);
    if (prepared.kind !== "approved_action") throw new Error("Expected approval");
    expect(JSON.parse((await prepared.action.execute()).content)).toMatchObject({ ok: false, code: "WINDOW_OCCLUDED", completedSteps: 1, failedStep: 2 });
    expect(f.execute).toHaveBeenCalledOnce();
  });
});
