import { describe, expect, it } from "vitest";

import type { ToolExecution } from "./project-tool-registry.js";
import { ToolHandlerRegistry, type ToolHandler } from "./tool-handler-registry.js";

type FixtureContext = {
  conversationId: string;
  projectId: string | undefined;
  runId: string;
  signal: AbortSignal;
};

function completed(content: string): ToolExecution {
  return { content, isError: false, kind: "completed" };
}

function handler(
  names: readonly string[],
  execute: (toolName: string) => Promise<ToolExecution>,
): ToolHandler<FixtureContext> {
  return {
    execute: ({ toolName }) => execute(toolName),
    getDefinitions: () => names.map((name) => ({
      description: name,
      name,
      parameters: { type: "object" },
    })),
    isAvailable: () => true,
  };
}

const context: FixtureContext = {
  conversationId: "conversation",
  projectId: undefined,
  runId: "run",
  signal: new AbortController().signal,
};

describe("ToolHandlerRegistry", () => {
  it("returns available definitions and dispatches by tool name", async () => {
    const registry = new ToolHandlerRegistry([
      handler(["read_file"], () => Promise.resolve(completed("read"))),
      handler(["send_agent_message"], () => Promise.resolve(completed("message"))),
    ]);

    expect(registry.getDefinitions({ projectId: undefined }).map((tool) => tool.name))
      .toEqual(["read_file", "send_agent_message"]);
    await expect(registry.execute({ context, rawArguments: "{}", toolName: "read_file" }))
      .resolves.toMatchObject({ content: "read" });
  });

  it("filters unavailable handlers without changing their definitions", () => {
    const registry = new ToolHandlerRegistry([
      { ...handler(["read_file"], () => Promise.resolve(completed("read"))), isAvailable: ({ projectId }) => projectId !== undefined },
      handler(["task"], () => Promise.resolve(completed("task"))),
    ]);

    expect(registry.getDefinitions({ projectId: undefined }).map((tool) => tool.name))
      .toEqual(["task"]);
  });

  it("rejects duplicate definitions and unknown tools deterministically", async () => {
    const duplicate = new ToolHandlerRegistry([
      handler(["same"], () => Promise.resolve(completed("one"))),
      handler(["same"], () => Promise.resolve(completed("two"))),
    ]);
    expect(() => duplicate.getDefinitions({ projectId: undefined }))
      .toThrow("Duplicate tool definition: same");

    const registry = new ToolHandlerRegistry([
      handler(["known"], () => Promise.resolve(completed("known"))),
    ]);
    await expect(registry.execute({ context, rawArguments: "{}", toolName: "missing" }))
      .rejects.toThrow("Unknown tool: missing");
  });
});
