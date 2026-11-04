import { describe, expect, it } from "vitest";
import { parseBackendSendCommand } from "./backend-command.js";

const conversationId = "3791f313-0656-492e-bd62-2c0dd3c3a8f8";

describe("backend command", () => {
  it("parses the strict local send payload", () => {
    expect(parseBackendSendCommand([
      "electron.exe",
      `--aster-send=${JSON.stringify({ conversationId, content: "hello" })}`,
    ])).toEqual({ conversationId, content: "hello" });
  });

  it("accepts an explicit provider and model for backend runs", () => {
    expect(parseBackendSendCommand([
      `--aster-send=${JSON.stringify({
        conversationId,
        content: "hello",
        modelId: "gpt-5.6-luna",
        providerId: "f915f61e-364a-4a9f-bbe5-998039226177",
      })}`,
    ])).toMatchObject({ modelId: "gpt-5.6-luna", providerId: "f915f61e-364a-4a9f-bbe5-998039226177" });
  });

  it.each([
    "--aster-send={not-json}",
    `--aster-send=${JSON.stringify({ conversationId })}`,
    `--aster-send=${JSON.stringify({ conversationId, content: "x", permissionMode: "read_only" })}`,
  ])("rejects malformed or privileged payloads: %s", (argument) => {
    expect(parseBackendSendCommand([argument])).toBeUndefined();
  });
});
