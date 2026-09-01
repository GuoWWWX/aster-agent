import { describe, expect, it } from "vitest";

import { shouldHandleTerminalKeyEvent } from "./terminal-workspace.js";

describe("terminal key input policy", () => {
  it("drops only auto-repeated Enter keydown events", () => {
    expect(shouldHandleTerminalKeyEvent({ key: "Enter", repeat: true, type: "keydown" })).toBe(false);
    expect(shouldHandleTerminalKeyEvent({ key: "Enter", repeat: false, type: "keydown" })).toBe(true);
    expect(shouldHandleTerminalKeyEvent({ key: "Enter", repeat: true, type: "keyup" })).toBe(true);
    expect(shouldHandleTerminalKeyEvent({ key: "Backspace", repeat: true, type: "keydown" })).toBe(true);
  });
});
