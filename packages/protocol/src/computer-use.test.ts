import { describe, expect, it } from "vitest";
import { computerApplicationIconsSchema, computerUseArgumentsSchema, computerUseConfigurationSchema, DEFAULT_COMPUTER_USE_CONFIGURATION, mergeComputerApplicationGrants, saveComputerUseConfigurationArgumentsSchema } from "./computer-use.js";
const application = { id: "11111111-1111-4111-8111-111111111111", name: "记事本", executablePath: "C:\\Windows\\notepad.exe", enabled: true };
describe("computer use boundary", () => {
  it("defaults to no access and rejects duplicate grants", () => {
    expect(computerUseConfigurationSchema.parse(DEFAULT_COMPUTER_USE_CONFIGURATION)).toMatchObject({ enabled: false, administrator: false, applications: [] });
    expect(computerUseConfigurationSchema.safeParse({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, applications: [application, { ...application, executablePath: application.executablePath.toUpperCase() }] }).success).toBe(false);
  });
  it("reads existing configurations as per-software authorization and validates blacklist and local icons", () => {
    expect(computerUseConfigurationSchema.parse({ version: 1, enabled: true, administrator: false, applications: [] })).toMatchObject({ accessMode: "ask", blockedApplications: [] });
    expect(computerUseConfigurationSchema.safeParse({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, blockedApplications: [application, application] }).success).toBe(false);
    expect(computerUseConfigurationSchema.safeParse({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, accessMode: "unrestricted" }).success).toBe(false);
    expect(computerApplicationIconsSchema.safeParse({ [application.id]: "https://example.test/icon.png" }).success).toBe(false);
    expect(computerApplicationIconsSchema.parse({ [application.id]: "data:image/png;base64,aGVsbG8=" })).toHaveProperty(application.id);
    expect(saveComputerUseConfigurationArgumentsSchema.safeParse([DEFAULT_COMPUTER_USE_CONFIGURATION]).success).toBe(true);
    expect(saveComputerUseConfigurationArgumentsSchema.safeParse([{ configuration: DEFAULT_COMPUTER_USE_CONFIGURATION, baselineApplications: [application] }]).success).toBe(true);
  });
  it("merges host approvals atomically while preserving explicit removal, disabling and server revocation", () => {
    expect(mergeComputerApplicationGrants([], [], [application])).toEqual([application]);
    expect(mergeComputerApplicationGrants([application], [], [application])).toEqual([]);
    expect(mergeComputerApplicationGrants([application], [{ ...application, enabled: false }], [application])).toEqual([{ ...application, enabled: false }]);
    expect(mergeComputerApplicationGrants([{ ...application, enabled: false }], [{ ...application, enabled: false }], [application])).toEqual([application]);
    expect(mergeComputerApplicationGrants([application], [application], [])).toEqual([]);
    expect(mergeComputerApplicationGrants([], [{ ...application, id: "22222222-2222-4222-8222-222222222222" }], [application])).toHaveLength(1);
  });
  it.each(["notepad.exe", "\\\\server\\share\\app.exe", "C:\\Windows\\script.ps1", "C:\\Windows\\a.exe\n"]) ("rejects unsafe application paths: %s", (executablePath) => {
    expect(computerUseConfigurationSchema.safeParse({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, applications: [{ ...application, executablePath }] }).success).toBe(false);
  });
  it("validates action-specific arguments and rejects arbitrary execution/elevation", () => {
    expect(computerUseArgumentsSchema.parse({ action: "click", windowId: "123", x: 2, y: 4 })).toMatchObject({ button: "left" });
    for (const input of [{ action: "click", windowId: "123" }, { action: "type", windowId: "123", text: "a", administrator: true },
      { action: "launch", applicationId: application.id, args: ["-Command", "whoami"] }, { action: "key", windowId: "123", key: "Enter", modifiers: ["meta"] },
      { action: "screenshot", windowId: "0x100" }, { action: "identify", windowId: "123" }, { action: "shell", command: "whoami" }]) expect(computerUseArgumentsSchema.safeParse(input).success).toBe(false);
  });
  it("accepts agent lifecycle without configuration or command overrides", () => {
    for (const action of ["status", "start", "stop"]) expect(computerUseArgumentsSchema.parse({ action })).toEqual({ action });
    for (const input of [{ action: "start", administrator: true }, { action: "start", accessMode: "all" },
      { action: "start", command: "calc.exe" }, { action: "stop", force: true }]) expect(computerUseArgumentsSchema.safeParse(input).success).toBe(false);
  });
  it("supports pointer-position scrolling, both axes, dragging, paste and ordered shortcuts", () => {
    expect(computerUseArgumentsSchema.parse({ action: "scroll", windowId: "123", delta: -2 })).toEqual({ action: "scroll", windowId: "123", delta: -2, axis: "vertical" });
    expect(computerUseArgumentsSchema.parse({ action: "scroll", windowId: "123", x: 40, y: 80, axis: "horizontal", delta: 3 })).toMatchObject({ x: 40, y: 80, axis: "horizontal" });
    const steps = [
      { action: "focus" }, { action: "move", x: 30, y: 40 },
      { action: "drag", path: [{ x: 10, y: 20 }, { x: 90, y: 80 }] },
      { action: "click", x: 20, y: 40, button: "middle", count: 2 },
      { action: "key", key: "A", modifiers: ["control"] }, { action: "paste", text: "中文\nText" },
      { action: "key", key: "F12", modifiers: ["control", "shift", "alt", "win"] }, { action: "key", key: "9" },
    ];
    expect(computerUseArgumentsSchema.parse({ action: "sequence", windowId: "123", steps })).toMatchObject({ steps });
    for (const step of steps) expect(computerUseArgumentsSchema.safeParse({ ...step, windowId: "123" }).success).toBe(true);
  });
  it("rejects incomplete positions, unbounded input and nested or cross-window sequences", () => {
    for (const input of [
      { action: "scroll", x: 3, delta: 1 }, { action: "scroll", delta: 0 },
      { action: "drag", path: [{ x: 1, y: 2 }] }, { action: "drag", path: [{ x: 1, y: 2 }, { x: 2, y: 3 }], durationMs: 6000 },
      { action: "key", key: "A", modifiers: ["control", "control"] }, { action: "key", key: "not-a-key" },
      { action: "sequence", steps: [] }, { action: "sequence", steps: [{ action: "start" }] },
      { action: "sequence", steps: [{ action: "key", key: "Enter", windowId: "456" }] },
      { action: "sequence", steps: Array.from({ length: 31 }, () => ({ action: "focus" })) },
      { action: "sequence", steps: Array.from({ length: 3 }, () => ({ action: "drag", path: [{ x: 0, y: 0 }, { x: 1, y: 1 }], durationMs: 5000 })) },
    ]) expect(computerUseArgumentsSchema.safeParse({ ...input, windowId: "123" }).success).toBe(false);
  });
});
