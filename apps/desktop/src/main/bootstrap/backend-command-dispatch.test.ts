import { describe, expect, it, vi } from "vitest";
import { dispatchBackendSendCommand } from "./backend-command-dispatch.js";

describe("backend command dispatch", () => {
  it("submits through the existing runtime and preserves the event callback", () => {
    const onEvent = vi.fn();
    const sendMessage = vi.fn(() => ({ kind: "started" as const, runId: "run-1" }));
    const runtime = { sendMessage };

    const result = dispatchBackendSendCommand({
      conversationId: "3791f313-0656-492e-bd62-2c0dd3c3a8f8",
      content: "hello",
    }, runtime, onEvent);

    expect(result).toBe("run-1");
    expect(sendMessage).toHaveBeenCalledWith({
      attachmentIds: [],
      content: "hello",
      conversationId: "3791f313-0656-492e-bd62-2c0dd3c3a8f8",
    }, onEvent);
  });
});
