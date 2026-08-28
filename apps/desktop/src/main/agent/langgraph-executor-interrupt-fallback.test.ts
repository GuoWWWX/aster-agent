import { GraphInterrupt } from "@langchain/langgraph";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("langchain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("langchain")>();
  return {
    ...actual,
    createAgent: vi.fn(() => ({ invoke })),
  };
});

import { LangGraphExecutor } from "./langgraph-executor.js";

describe("LangGraphExecutor interrupt fallback", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("resumes when the compiled graph throws its interrupt instead of returning it", async () => {
    invoke
      .mockRejectedValueOnce(new GraphInterrupt([{
        id: "approval-interrupt",
        value: { kind: "tool_approval" },
      }]))
      .mockResolvedValueOnce({
        activeSkills: [],
        contextPrepared: true,
        hasFollowUpInput: false,
        hasSuccessfulToolExecution: true,
        messages: [],
        turns: 1,
      });
    const onInterrupt = vi.fn(() => Promise.resolve(true));

    const result = await new LangGraphExecutor().invoke({
      callbacks: {
        beforeModel: () => Promise.resolve({ hasFollowUpInput: false, messages: [] }),
        callModel: () => Promise.reject(new Error("The mocked graph owns model execution.")),
        executeTools: () => Promise.reject(new Error("The mocked graph owns tool execution.")),
      },
      initialMessages: [],
      maxSteps: 2,
      onInterrupt,
      signal: new AbortController().signal,
      threadId: "raw-interrupt-run",
    });

    expect(onInterrupt).toHaveBeenCalledWith([{
      id: "approval-interrupt",
      value: { kind: "tool_approval" },
    }]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.hasSuccessfulToolExecution).toBe(true);
  });
});
