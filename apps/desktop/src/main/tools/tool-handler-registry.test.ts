import { describe, expect, it, vi } from "vitest";

import type { ToolExecution } from "./project-tool-registry.js";
import {
  ToolHandlerRegistry,
  type ToolExecutionPolicy,
  type ToolHandler,
} from "./tool-handler-registry.js";

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
  policy?: ToolExecutionPolicy,
): ToolHandler<FixtureContext> {
  return {
    execute: ({ toolName }) => execute(toolName),
    ...(policy === undefined ? {} : { getExecutionPolicy: () => policy }),
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
  it("applies the same current tool scope to definitions, scheduling and execution", async () => {
    const execute = vi.fn(() => Promise.resolve(completed("changed")));
    let allowed = new Set(["read_file"]);
    const registry = new ToolHandlerRegistry([
      handler(["read_file", "write_file"], execute),
    ], () => allowed);
    expect(registry.getDefinitions(context).map(tool => tool.name)).toEqual(["read_file"]);
    expect(() => registry.getExecutionPolicy({ context, rawArguments: "{}", toolName: "write_file" })).toThrow("Unknown tool");
    await expect(registry.execute({ context, rawArguments: "{}", toolName: "write_file" })).rejects.toThrow("Unknown tool");
    expect(execute).not.toHaveBeenCalled();
    allowed = new Set(["write_file"]);
    expect(registry.getDefinitions(context).map(tool => tool.name)).toEqual(["write_file"]);
    await expect(registry.execute({ context, rawArguments: "{}", toolName: "write_file" })).resolves.toMatchObject({ content: "changed" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("checks per-tool availability while advertising a multi-tool handler", () => {
    const registry = new ToolHandlerRegistry([{
      ...handler(["read_file", "write_file"], () => Promise.resolve(completed("read"))),
      isAvailable: ({ toolName }) => toolName !== "write_file",
    }]);
    expect(registry.getDefinitions(context).map(tool => tool.name)).toEqual(["read_file"]);
  });
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

  it("sorts the model-visible manifest by name independently of registration order", () => {
    const registry = new ToolHandlerRegistry([
      handler(["write_file"], () => Promise.resolve(completed("write"))),
      handler(["find_files", "read_file"], () => Promise.resolve(completed("read"))),
    ]);

    expect(registry.getDefinitions({ projectId: undefined }).map((tool) => tool.name)).toEqual([
      "find_files",
      "read_file",
      "write_file",
    ]);
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

  it("returns the handler-owned scheduling policy", () => {
    const registry = new ToolHandlerRegistry([
      handler(["read_file"], () => Promise.resolve(completed("read")), {
        group: "read",
        kind: "parallel",
      }),
    ]);

    expect(registry.getExecutionPolicy({
      context,
      rawArguments: "{}",
      toolName: "read_file",
    })).toEqual({ group: "read", kind: "parallel" });
  });
});
