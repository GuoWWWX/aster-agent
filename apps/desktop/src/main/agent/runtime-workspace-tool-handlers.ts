import type { ComputerUseTool } from "../computer-use/computer-use-tool.js";
import type { BrowserToolPlugin } from "../plugins/browser-tool-plugin.js";
import type { ConversationAttachmentTool } from "../tools/conversation-attachment-tool.js";
import type { HtmlPresentationTool } from "../tools/html-presentation-tool.js";
import type { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import type { ToolHandler } from "../tools/tool-handler-registry.js";
import type { WebSearchTool } from "../tools/web-search-tool.js";
import type { WorkspaceTerminalTool } from "../tools/workspace-terminal-tool.js";
import type { RuntimeToolContext } from "./runtime-tool-context.js";

type ProjectExecutionPort = Pick<ProjectToolRegistry, "execute">;

export function createHtmlPresentationToolHandler(
  htmlPresentationTool: Pick<HtmlPresentationTool, "execute" | "getDefinitions">,
  canInspectInline: (conversationId: string) => boolean,
): ToolHandler<RuntimeToolContext> {
  return {
    execute: ({ context, rawArguments }) => htmlPresentationTool.execute(context.conversationId, rawArguments, context.signal,
      canInspectInline(context.conversationId)),
    getDefinitions: ({ conversationId }) => htmlPresentationTool.getDefinitions(conversationId !== undefined
      && canInspectInline(conversationId)),
    getExecutionPolicy: () => ({ kind: "serial" }),
    isAvailable: () => true,
  };
}

export function createAttachmentToolHandler(
  attachmentTool: Pick<ConversationAttachmentTool, "execute" | "viewImages" | "getDefinitions" | "getExecutionPolicy">,
  tools: ProjectExecutionPort,
): ToolHandler<RuntimeToolContext> {
  return {
    execute: async ({ context, rawArguments, toolName }) => {
      const attachmentResult = toolName === "view_attachments"
        ? await attachmentTool?.viewImages(context.conversationId, rawArguments,
          async (imagePath) => tools.execute("view_image", JSON.stringify({ path: imagePath }), context.projectId, context.signal, context.operationOwner),
          context.signal)
        : attachmentTool?.execute(
        toolName,
        context.conversationId,
        rawArguments,
      );
      return Promise.resolve({
        content: attachmentResult?.content ?? "Attachment tool is unavailable.",
        isError: attachmentResult?.isError ?? true,
        kind: "completed" as const,
        ...(attachmentResult?.modelAttachments === undefined
          ? {}
          : { modelAttachments: attachmentResult.modelAttachments }),
      });
    },
    getDefinitions: () => attachmentTool?.getDefinitions() ?? [],
    getExecutionPolicy: ({ toolName }) => {
      if (attachmentTool === null) throw new Error("Attachment tool is unavailable.");
      return attachmentTool.getExecutionPolicy(toolName);
    },
    isAvailable: () => true,
  };
}

export type WorkspaceToolDependencies = {
  browserToolPlugin: Pick<BrowserToolPlugin, "execute" | "getDefinitions"> | null;
  computerUseTool: Pick<ComputerUseTool, "execute" | "getDefinitions"> | null;
  tools: ProjectExecutionPort & Pick<ProjectToolRegistry, "getCommandDefinitions" | "getProjectDefinitions" | "getExecutionPolicy">;
  webSearchTool: Pick<WebSearchTool, "execute" | "prepareApproval" | "getDefinitions" | "getExecutionPolicy">;
  workspaceTerminalTool: Pick<WorkspaceTerminalTool, "execute" | "getDefinitions"> | null;
};

/** Adapts execution capabilities; Run ownership, approvals and audit stay in AgentRuntime. */
export function createWorkspaceToolHandlers(
  dependencies: WorkspaceToolDependencies,
): ToolHandler<RuntimeToolContext>[] {
  const handlers: ToolHandler<RuntimeToolContext>[] = [];
  handlers.push({
    execute: ({ context, rawArguments }) => context.permissionMode !== "full_access" && context.permissionMode !== "read_only"
      ? Promise.resolve(dependencies.webSearchTool.prepareApproval(rawArguments, context.signal))
      : dependencies.webSearchTool.execute(rawArguments, context.signal),
    getDefinitions: () => dependencies.webSearchTool.getDefinitions(),
    getExecutionPolicy: ({ context }) => context.permissionMode !== "full_access" && context.permissionMode !== "read_only"
      ? { kind: "serial" } : dependencies.webSearchTool.getExecutionPolicy(),
    isAvailable: () => true,
  });
  if (dependencies.workspaceTerminalTool !== null) {
    handlers.push({
      execute: ({ context, rawArguments, toolName }) => dependencies.workspaceTerminalTool?.execute({
        conversationId: context.conversationId,
        operationOwner: context.operationOwner,
        projectId: context.projectId,
        rawArguments,
        signal: context.signal,
        toolName,
      }) ?? Promise.resolve({
        content: "Workspace terminal tool is unavailable.",
        isError: true,
        kind: "completed" as const,
      }),
      getDefinitions: () => dependencies.workspaceTerminalTool?.getDefinitions() ?? [],
      getExecutionPolicy: () => ({ kind: "serial" }),
      isAvailable: ({ projectId }) => projectId !== undefined,
    });
  }
  const computerUseTool = dependencies.computerUseTool;
  if (computerUseTool !== null) {
    handlers.push({
      execute: ({ context, rawArguments }) => computerUseTool.execute(rawArguments, context.signal),
      getDefinitions: () => computerUseTool.getDefinitions(),
      getExecutionPolicy: () => ({ kind: "serial" }),
      isAvailable: () => true,
    });
  }
  if (dependencies.browserToolPlugin !== null) {
    handlers.push({
      execute: ({ context, rawArguments, toolName }) => dependencies.browserToolPlugin?.execute({
        conversationId: context.conversationId,
        projectId: context.projectId,
        rawArguments,
        signal: context.signal,
        toolName,
      }) ?? Promise.resolve({
        content: "Browser plugin is unavailable.",
        isError: true,
        kind: "completed" as const,
      }),
      getDefinitions: () => dependencies.browserToolPlugin?.getDefinitions() ?? [],
      getExecutionPolicy: () => ({ kind: "serial" }),
      isAvailable: ({ projectId }) => projectId !== undefined,
    });
  }
  handlers.push({
    execute: ({ context, rawArguments, toolName }) => {
      return dependencies.tools.execute(
        toolName,
        rawArguments,
        context.projectId,
        context.signal,
        context.operationOwner,
      );
    },
    getDefinitions: () => dependencies.tools.getCommandDefinitions(),
    getExecutionPolicy: ({ context, rawArguments, toolName }) => dependencies.tools.getExecutionPolicy(
      toolName,
      rawArguments,
      context.permissionMode !== "read_only",
    ),
    isAvailable: () => true,
  });
  handlers.push({
    execute: ({ context, rawArguments, toolName }) => {
      return dependencies.tools.execute(
        toolName,
        rawArguments,
        context.projectId,
        context.signal,
        context.operationOwner,
      );
    },
    getDefinitions: () => dependencies.tools.getProjectDefinitions().filter(
      (definition) => definition.name === "read_external_file",
    ),
    getExecutionPolicy: ({ context, rawArguments, toolName }) => dependencies.tools.getExecutionPolicy(
      toolName,
      rawArguments,
      context.permissionMode !== "read_only",
    ),
    isAvailable: () => true,
  });
  handlers.push({
    execute: ({ context, rawArguments, toolName }) => {
      if (context.projectId === undefined) {
        throw new Error("A workspace is required for project tools.");
      }
      return dependencies.tools.execute(
        toolName,
        rawArguments,
        context.projectId,
        context.signal,
        context.operationOwner,
      );
    },
    getDefinitions: () => dependencies.tools.getProjectDefinitions().filter(
      (definition) => definition.name !== "read_external_file" && definition.name !== "view_image",
    ),
    getExecutionPolicy: ({ context, rawArguments, toolName }) => dependencies.tools.getExecutionPolicy(
      toolName,
      rawArguments,
      context.permissionMode !== "read_only",
    ),
    isAvailable: ({ projectId }) => projectId !== undefined,
  });
  return handlers;
}
