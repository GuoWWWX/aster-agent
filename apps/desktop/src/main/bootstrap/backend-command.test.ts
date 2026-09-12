import { describe, expect, it } from "vitest";
import { parseBackendSendCommand } from "./backend-command.js";

const conversationId = "3791f313-0656-492e-bd62-2c0dd3c3a8f8";

describe("backend command", () => {
  it("parses the strict local send payload", () => {
    expect(parseBackendSendCommand([
      "electron.exe",
      `--aster-send={\"conversationId\":\"${conversationId}\",\"content\":\"hello\"}`,
    ])).toEqual({ conversationId, content: "hello" });
  });

  it.each([
    "--aster-send={not-json}",
    `--aster-send={\"conversationId\":\"${conversationId}\"}`,
    `--aster-send={\"conversationId\":\"${conversationId}\",\"content\":\"x\",\"permissionMode\":\"read_only\"}`,
  ])("rejects malformed or privileged payloads: %s", (argument) => {
    expect(parseBackendSendCommand([argument])).toBeUndefined();
  });
});
