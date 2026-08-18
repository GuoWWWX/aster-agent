import { parseSerializedAgentError } from "@agent/protocol";
import { describe, expect, it, vi } from "vitest";

import { runIpcHandler } from "./ipc-error-boundary.js";

describe("IPC error boundary", () => {
  it("returns successful handler results unchanged", async () => {
    await expect(runIpcHandler("project:list", () => ({ ok: true }))).resolves.toEqual({
      ok: true,
    });
  });

  it("serializes rejected handlers as AgentError envelopes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let rejection: unknown;
    try {
      await runIpcHandler("project:read-file", () => {
        throw new Error("Project path is outside the registered project root.");
      });
    } catch (reason) {
      rejection = reason;
    }

    const parsed = parseSerializedAgentError(rejection);
    expect(parsed?.code).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(parsed?.details).toMatchObject({ operation: "ipc:project:read-file" });
    consoleError.mockRestore();
  });
});
