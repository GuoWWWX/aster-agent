import { DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION, type ConversationPermissionMode } from "@agent/protocol";
import { describe, expect, it, vi } from "vitest";

import type { ModelToolDefinition } from "../model/model-contracts.js";
import type { ToolExecutionResult } from "../tools/project-tool-registry.js";
import { ToolHandlerRegistry } from "../tools/tool-handler-registry.js";
import type { RuntimeToolContext } from "./runtime-tool-context.js";
import {
  createAttachmentToolHandler,
  createHtmlPresentationToolHandler,
  createWorkspaceToolHandlers,
  type WorkspaceToolDependencies,
} from "./runtime-workspace-tool-handlers.js";

const completed: ToolExecutionResult = { content: "bounded result", isError: false, kind: "completed" };

function definitions(...names: string[]): ModelToolDefinition[] {
  return names.map(name => ({ description: name, name, parameters: { type: "object" } }));
}

function context(permissionMode: ConversationPermissionMode = "full_access", projectId?: string): RuntimeToolContext {
  return {
    configuration: { apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://example.test", modelId: "fixture", reasoningOptions: [] },
    contextCompressionConfiguration: DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
    conversationId: "conversation",
    emit: vi.fn(),
    onTaskListChanged: vi.fn(),
    operationOwner: { conversationId: "conversation", conversationTitle: "Fixture", runId: "run" },
    permissionMode,
    projectId,
    providerId: undefined,
    reasoning: undefined,
    runId: "run",
    signal: new AbortController().signal,
  };
}

function dependencies(): WorkspaceToolDependencies {
  return {
    browserToolPlugin: null,
    computerUseTool: null,
    tools: {
      execute: vi.fn(() => Promise.resolve(completed)),
      getCommandDefinitions: () => definitions("run_command"),
      getExecutionPolicy: vi.fn<WorkspaceToolDependencies["tools"]["getExecutionPolicy"]>(() => ({ group: "read", kind: "parallel" })),
      getProjectDefinitions: () => definitions("read_external_file", "read_file", "view_image"),
    },
    webSearchTool: {
      execute: vi.fn(() => Promise.resolve(completed)),
      getDefinitions: () => definitions("web_search"),
      getExecutionPolicy: () => ({ group: "read", kind: "parallel" }),
      prepareApproval: vi.fn<WorkspaceToolDependencies["webSearchTool"]["prepareApproval"]>(() => ({
        content: "prepared",
        isError: false,
        kind: "approved_action",
        action: { execute: () => Promise.resolve(completed), pattern: "web", permissionTool: "web_search", rejectionMessage: "rejected" },
      })),
    },
    workspaceTerminalTool: null,
  };
}

describe("Runtime workspace tool adapters", () => {
  it("keeps command/external reads available without a workspace and excludes direct view_image", async () => {
    const ports = dependencies();
    const registry = new ToolHandlerRegistry(createWorkspaceToolHandlers(ports));
    expect(registry.getDefinitions(context()).map(tool => tool.name)).toEqual(["read_external_file", "run_command", "web_search"]);
    expect(registry.getDefinitions(context("full_access", "project")).map(tool => tool.name)).toEqual(["read_external_file", "read_file", "run_command", "web_search"]);
    await expect(registry.execute({ context: context(), rawArguments: "{}", toolName: "read_file" })).rejects.toThrow("Unknown tool");
    expect(ports.tools.execute).not.toHaveBeenCalled();
  });

  it.each(["request_approval", "auto_review", "ask_before_changes"] as const)("prepares ordered search approval for %s without starting network execution", async mode => {
    const ports = dependencies();
    const registry = new ToolHandlerRegistry(createWorkspaceToolHandlers(ports));
    const input = { context: context(mode), rawArguments: '{"query":"fixture"}', toolName: "web_search" };
    expect(registry.getExecutionPolicy(input)).toEqual({ kind: "serial" });
    await expect(registry.execute(input)).resolves.toMatchObject({ kind: "approved_action" });
    expect(ports.webSearchTool.prepareApproval).toHaveBeenCalledWith(input.rawArguments, input.context.signal);
    expect(ports.webSearchTool.execute).not.toHaveBeenCalled();
  });

  it.each(["full_access", "read_only"] as const)("preserves direct read-only search execution for %s", async mode => {
    const ports = dependencies();
    const registry = new ToolHandlerRegistry(createWorkspaceToolHandlers(ports));
    const input = { context: context(mode), rawArguments: "{}", toolName: "web_search" };
    expect(registry.getExecutionPolicy(input)).toEqual({ group: "read", kind: "parallel" });
    await expect(registry.execute(input)).resolves.toBe(completed);
    expect(ports.webSearchTool.execute).toHaveBeenCalledWith(input.rawArguments, input.context.signal);
    expect(ports.webSearchTool.prepareApproval).not.toHaveBeenCalled();
  });

  it.each(["read_only", "full_access"] as const)("forwards project ownership, signal and scheduler permission for %s", async mode => {
    const ports = dependencies();
    const registry = new ToolHandlerRegistry(createWorkspaceToolHandlers(ports));
    const input = { context: context(mode, "project"), rawArguments: '{"path":"file.txt"}', toolName: "read_file" };
    expect(registry.getExecutionPolicy(input)).toEqual({ group: "read", kind: "parallel" });
    expect(ports.tools.getExecutionPolicy).toHaveBeenCalledWith("read_file", input.rawArguments, mode !== "read_only");
    await expect(registry.execute(input)).resolves.toBe(completed);
    expect(ports.tools.execute).toHaveBeenCalledWith("read_file", input.rawArguments, "project", input.context.signal, input.context.operationOwner);
  });

  it("retains capability order, workspace requirements and serial scheduling of optional integrations", async () => {
    const ports = dependencies();
    ports.workspaceTerminalTool = { execute: vi.fn(() => Promise.resolve(completed)), getDefinitions: () => definitions("terminal") };
    ports.browserToolPlugin = { execute: vi.fn(() => Promise.resolve(completed)), getDefinitions: () => definitions("browser") };
    ports.computerUseTool = { execute: vi.fn(() => Promise.resolve(completed)), getDefinitions: () => definitions("computer") };
    const handlers = createWorkspaceToolHandlers(ports);
    expect(handlers.map(handler => handler.getDefinitions(context()).map(tool => tool.name))).toEqual([
      ["web_search"], ["terminal"], ["computer"], ["browser"], ["run_command"], ["read_external_file"], ["read_file"],
    ]);
    const registry = new ToolHandlerRegistry(handlers);
    expect(registry.getDefinitions(context()).map(tool => tool.name)).toEqual(["computer", "read_external_file", "run_command", "web_search"]);
    const runContext = context("full_access", "project");
    for (const toolName of ["terminal", "computer", "browser"]) {
      const input = { context: runContext, rawArguments: "{}", toolName };
      expect(registry.getExecutionPolicy(input)).toEqual({ kind: "serial" });
      await expect(registry.execute(input)).resolves.toBe(completed);
    }
    expect(ports.workspaceTerminalTool.execute).toHaveBeenCalledWith({ conversationId: "conversation", projectId: "project", operationOwner: runContext.operationOwner, rawArguments: "{}", signal: runContext.signal, toolName: "terminal" });
    expect(ports.browserToolPlugin.execute).toHaveBeenCalledWith({ conversationId: "conversation", projectId: "project", rawArguments: "{}", signal: runContext.signal, toolName: "browser" });
    expect(ports.computerUseTool.execute).toHaveBeenCalledWith("{}", runContext.signal);
  });

  it("uses the same live inline-inspection scope for the HTML manifest and execution", async () => {
    let inline = false;
    const tool = { execute: vi.fn(() => Promise.resolve(completed)), getDefinitions: vi.fn(() => definitions("present_html")) };
    const handler = createHtmlPresentationToolHandler(tool, () => inline);
    handler.getDefinitions({ projectId: undefined });
    expect(tool.getDefinitions).toHaveBeenLastCalledWith(false);
    inline = true;
    const runContext = context();
    handler.getDefinitions(runContext);
    expect(tool.getDefinitions).toHaveBeenLastCalledWith(true);
    await handler.execute({ context: runContext, rawArguments: "{}", toolName: "present_html" });
    expect(tool.execute).toHaveBeenCalledWith("conversation", "{}", runContext.signal, true);
    expect(handler.getExecutionPolicy?.({ context: runContext, rawArguments: "{}", toolName: "present_html" })).toEqual({ kind: "serial" });
  });

  it("routes workspace image reads through the existing project boundary and retains model attachments", async () => {
    const modelAttachments = [{ kind: "image" as const, data: null, id: "image", contextTokens: 85, mimeType: "image/png", name: "image.png", projectPath: "image.png", readState: "full" as const, source: "project" as const, truncated: false }];
    const result = { ...completed, modelAttachments };
    const ports = dependencies();
    ports.tools.execute = vi.fn(() => Promise.resolve(result));
    const tool = {
      execute: vi.fn(() => ({ content: "attachment", isError: false })),
      getDefinitions: () => definitions("view_attachments", "read_attachment"),
      getExecutionPolicy: () => ({ kind: "parallel" as const, group: "read" as const }),
      viewImages: vi.fn<Parameters<typeof createAttachmentToolHandler>[0]["viewImages"]>(async (_conversation, _raw, readImage) => readImage("image.png")),
    };
    const handler = createAttachmentToolHandler(tool, ports.tools);
    const runContext = context("full_access", "project");
    const input = { context: runContext, rawArguments: '{"paths":["image.png"]}', toolName: "view_attachments" };
    await expect(handler.execute(input)).resolves.toEqual(result);
    expect(ports.tools.execute).toHaveBeenCalledWith("view_image", '{"path":"image.png"}', "project", runContext.signal, runContext.operationOwner);
    expect(handler.getExecutionPolicy?.(input)).toEqual({ kind: "parallel", group: "read" });
    await expect(handler.execute({ ...input, toolName: "read_attachment" })).resolves.toEqual({ content: "attachment", isError: false, kind: "completed" });
    expect(tool.execute).toHaveBeenCalledWith("read_attachment", "conversation", input.rawArguments);
  });
});
