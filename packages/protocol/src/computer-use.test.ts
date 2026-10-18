import { describe, expect, it } from "vitest";
import { computerUseArgumentsSchema, computerUseConfigurationSchema, DEFAULT_COMPUTER_USE_CONFIGURATION } from "./computer-use.js";
const application = { id: "11111111-1111-4111-8111-111111111111", name: "记事本", executablePath: "C:\\Windows\\notepad.exe", enabled: true };
describe("computer use boundary", () => {
  it("defaults to no access and rejects duplicate grants", () => {
    expect(computerUseConfigurationSchema.parse(DEFAULT_COMPUTER_USE_CONFIGURATION)).toMatchObject({ enabled: false, administrator: false, applications: [] });
    expect(computerUseConfigurationSchema.safeParse({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, applications: [application, { ...application, executablePath: application.executablePath.toUpperCase() }] }).success).toBe(false);
  });
  it.each(["notepad.exe", "\\\\server\\share\\app.exe", "C:\\Windows\\script.ps1", "C:\\Windows\\a.exe\n"]) ("rejects unsafe application paths: %s", (executablePath) => {
    expect(computerUseConfigurationSchema.safeParse({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, applications: [{ ...application, executablePath }] }).success).toBe(false);
  });
  it("validates action-specific arguments and rejects arbitrary execution/elevation", () => {
    expect(computerUseArgumentsSchema.parse({ action: "click", windowId: "123", x: 2, y: 4 })).toMatchObject({ button: "left" });
    for (const input of [{ action: "click", windowId: "123" }, { action: "type", windowId: "123", text: "a", administrator: true },
      { action: "launch", applicationId: application.id, args: ["-Command", "whoami"] }, { action: "key", windowId: "123", key: "Enter", modifiers: ["meta"] },
      { action: "screenshot", windowId: "0x100" }, { action: "shell", command: "whoami" }]) expect(computerUseArgumentsSchema.safeParse(input).success).toBe(false);
  });
});
