import { z } from "zod";

import type { ModelToolDefinition } from "../model/model-contracts.js";
import { toolErrorContent } from "../errors/tool-error.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import type { ToolExecution, ToolExecutionResult } from "../tools/project-tool-registry.js";
import type { WorkspaceBrowserTabPort } from "../tools/workspace-browser-tab-controller.js";
import type {
  ManagedBrowserAutomationPort,
  ManagedBrowserInteraction,
} from "../windows/managed-browser-controller.js";

const browserIdSchema = z.string().uuid();

const browserOpenArgumentsSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().min(1).max(8_192),
}).strict();

const browserReferenceArgumentsSchema = z.object({ browserId: browserIdSchema }).strict();

const browserNavigateArgumentsSchema = browserReferenceArgumentsSchema.extend({
  url: z.string().trim().min(1).max(8_192),
}).strict();

const browserElementArgumentsSchema = browserReferenceArgumentsSchema.extend({
  elementId: z.string().trim().min(1).max(120),
}).strict();

const browserFillArgumentsSchema = browserElementArgumentsSchema.extend({
  text: z.string().max(32_000),
}).strict();

const browserSelectArgumentsSchema = browserElementArgumentsSchema.extend({
  value: z.string().max(4_000),
}).strict();

const browserKeyArgumentsSchema = browserReferenceArgumentsSchema.extend({
  key: z.enum(["Enter", "Escape", "Tab", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"]),
}).strict();

const browserScrollArgumentsSchema = browserReferenceArgumentsSchema.extend({
  deltaX: z.number().int().min(-20_000).max(20_000).default(0),
  deltaY: z.number().int().min(-20_000).max(20_000),
}).strict();

const browserWaitArgumentsSchema = browserReferenceArgumentsSchema.extend({
  timeoutMs: z.number().int().min(100).max(30_000).default(1_000),
}).strict();

export const BROWSER_PLUGIN_ID = "agent.browser";
export const BROWSER_TOOL_NAMES = {
  click: "browser_click",
  close: "browser_close",
  fill: "browser_fill",
  key: "browser_key",
  navigate: "browser_navigate",
  observe: "browser_observe",
  open: "browser_open",
  scroll: "browser_scroll",
  select: "browser_select_option",
  wait: "browser_wait",
} as const;

type OwnedBrowser = {
  conversationId: string;
  projectId: string;
};

/**
 * First-party browser plugin. It is deliberately a separate tool group so
 * browser navigation state, element references and lifecycle do not leak into
 * the general file/command tool registry. It exposes controlled DOM actions,
 * not arbitrary page JavaScript.
 */
export class BrowserToolPlugin {
  private readonly browsers = new Map<string, OwnedBrowser>();

  public constructor(
    private readonly browser: ManagedBrowserAutomationPort,
    private readonly workspaceTabs: WorkspaceBrowserTabPort,
  ) {}

  public getDefinitions(): readonly ModelToolDefinition[] {
    return [
      {
        description: "Open a persistent, user-visible browser tab through the browser plugin. The returned browserId is used by every other browser_* tool. Browser tabs are isolated, accept only HTTP/HTTPS without embedded credentials, and block downloads and permission prompts.",
        name: BROWSER_TOOL_NAMES.open,
        parameters: modelToolParameters(browserOpenArgumentsSchema),
      },
      {
        description: "Observe the current page and return bounded visible text plus stable element references. Always observe before click, fill or select; references become stale after navigation or page updates.",
        name: BROWSER_TOOL_NAMES.observe,
        parameters: modelToolParameters(browserReferenceArgumentsSchema),
      },
      {
        description: "Navigate one browser tab to an HTTP/HTTPS URL or a text search. Observe the page again after navigation.",
        name: BROWSER_TOOL_NAMES.navigate,
        parameters: modelToolParameters(browserNavigateArgumentsSchema),
      },
      {
        description: "Click one element reference returned by browser_observe. Observe again after the click before using another reference.",
        name: BROWSER_TOOL_NAMES.click,
        parameters: modelToolParameters(browserElementArgumentsSchema),
      },
      {
        description: "Replace the text of one input, textarea or editable element returned by browser_observe.",
        name: BROWSER_TOOL_NAMES.fill,
        parameters: modelToolParameters(browserFillArgumentsSchema),
      },
      {
        description: "Select an option by its value in a select element returned by browser_observe.",
        name: BROWSER_TOOL_NAMES.select,
        parameters: modelToolParameters(browserSelectArgumentsSchema),
      },
      {
        description: "Send one supported navigation or confirmation key to the focused browser element.",
        name: BROWSER_TOOL_NAMES.key,
        parameters: modelToolParameters(browserKeyArgumentsSchema),
      },
      {
        description: "Scroll a browser tab by pixel deltas, then observe it again.",
        name: BROWSER_TOOL_NAMES.scroll,
        parameters: modelToolParameters(browserScrollArgumentsSchema),
      },
      {
        description: "Wait briefly for a browser page to settle, then return its current URL and title. Observe again for fresh element references.",
        name: BROWSER_TOOL_NAMES.wait,
        parameters: modelToolParameters(browserWaitArgumentsSchema),
      },
      {
        description: "Close one browser tab created by this conversation's browser plugin.",
        name: BROWSER_TOOL_NAMES.close,
        parameters: modelToolParameters(browserReferenceArgumentsSchema),
      },
    ];
  }

  public async execute(input: {
    conversationId: string;
    projectId: string | undefined;
    rawArguments: string;
    signal: AbortSignal;
    toolName: string;
  }): Promise<ToolExecution> {
    try {
      if (input.projectId === undefined) throw new Error("A project workspace is required for the browser plugin.");
      const projectInput = { ...input, projectId: input.projectId };
      switch (input.toolName) {
        case BROWSER_TOOL_NAMES.open:
          return this.prepareOpen(projectInput);
        case BROWSER_TOOL_NAMES.observe:
          return await this.observe(projectInput);
        case BROWSER_TOOL_NAMES.navigate:
          return this.prepareNavigate(projectInput);
        case BROWSER_TOOL_NAMES.click:
          return this.prepareInteraction(projectInput, "click");
        case BROWSER_TOOL_NAMES.fill:
          return this.prepareInteraction(projectInput, "fill");
        case BROWSER_TOOL_NAMES.select:
          return this.prepareInteraction(projectInput, "select");
        case BROWSER_TOOL_NAMES.key:
          return this.prepareInteraction(projectInput, "key");
        case BROWSER_TOOL_NAMES.scroll:
          return this.prepareInteraction(projectInput, "scroll");
        case BROWSER_TOOL_NAMES.wait:
          return await this.wait(projectInput);
        case BROWSER_TOOL_NAMES.close:
          return this.prepareClose(projectInput);
        default:
          throw new Error(`Unsupported browser plugin tool: ${input.toolName}`);
      }
    } catch (error) {
      if (input.signal.aborted) throw error;
      return { content: toolErrorContent(error, `tool:${input.toolName}`), isError: true, kind: "completed" };
    }
  }

  private prepareOpen(input: {
    conversationId: string;
    projectId: string;
    rawArguments: string;
    signal: AbortSignal;
  }): ToolExecution {
    const arguments_ = browserOpenArgumentsSchema.parse(parseToolArguments(input.rawArguments));
    return this.approvedAction(
      `open ${arguments_.url}`,
      "The user rejected opening this browser page.",
      () => this.open(input, arguments_),
    );
  }

  private async open(input: {
    conversationId: string;
    projectId: string;
    rawArguments: string;
    signal: AbortSignal;
  }, arguments_: z.infer<typeof browserOpenArgumentsSchema>): Promise<ToolExecutionResult> {
    const session = await this.browser.open({ url: arguments_.url });
    try {
      const tab = await this.workspaceTabs.open({
        conversationId: input.conversationId,
        projectId: input.projectId,
        requestedName: arguments_.name ?? null,
        session,
        signal: input.signal,
      });
      this.browsers.set(session.sessionId, {
        conversationId: input.conversationId,
        projectId: input.projectId,
      });
      return this.success({
        browserId: session.sessionId,
        nameAdjusted: tab.requestedName !== null && tab.requestedName !== tab.resolvedName,
        requestedName: tab.requestedName,
        resolvedName: tab.resolvedName,
        title: session.title,
        url: session.url,
      });
    } catch (error) {
      this.browser.close({ sessionId: session.sessionId });
      throw error;
    }
  }

  private async observe(input: { conversationId: string; projectId: string; rawArguments: string }): Promise<ToolExecution> {
    const arguments_ = browserReferenceArgumentsSchema.parse(parseToolArguments(input.rawArguments));
    this.requireOwnedBrowser(input.conversationId, input.projectId, arguments_.browserId);
    return this.success(await this.browser.observe({ sessionId: arguments_.browserId }));
  }

  private prepareNavigate(input: {
    conversationId: string;
    projectId: string;
    rawArguments: string;
  }): ToolExecution {
    const arguments_ = browserNavigateArgumentsSchema.parse(parseToolArguments(input.rawArguments));
    this.requireOwnedBrowser(input.conversationId, input.projectId, arguments_.browserId);
    return this.approvedAction(
      `navigate ${arguments_.url}`,
      "The user rejected this browser navigation.",
      () => this.navigate(arguments_),
    );
  }

  private async navigate(
    arguments_: z.infer<typeof browserNavigateArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    await this.browser.navigate({ sessionId: arguments_.browserId, url: arguments_.url });
    return this.success({ browserId: arguments_.browserId, navigated: true });
  }

  private prepareInteraction(
    input: { conversationId: string; projectId: string; rawArguments: string },
    kind: ManagedBrowserInteraction["kind"],
  ): ToolExecution {
    const rawArguments = parseToolArguments(input.rawArguments);
    const interaction = this.interactionFor(kind, rawArguments);
    this.requireOwnedBrowser(input.conversationId, input.projectId, interaction.browserId);
    const { browserId, ...action } = interaction;
    const target = "elementId" in action ? ` ${action.elementId}` : "key" in action ? ` ${action.key}` : "";
    return this.approvedAction(
      `${kind}${target}`,
      "The user rejected this browser interaction.",
      () => this.interact(browserId, action),
    );
  }

  private async interact(
    browserId: string,
    action: ManagedBrowserInteraction,
  ): Promise<ToolExecutionResult> {
    await this.browser.interact({ sessionId: browserId, ...action });
    return this.success({ browserId, performed: action.kind });
  }

  private async wait(input: {
    conversationId: string;
    projectId: string;
    rawArguments: string;
    signal: AbortSignal;
  }): Promise<ToolExecution> {
    const arguments_ = browserWaitArgumentsSchema.parse(parseToolArguments(input.rawArguments));
    this.requireOwnedBrowser(input.conversationId, input.projectId, arguments_.browserId);
    await waitFor(arguments_.timeoutMs, input.signal);
    const observation = await this.browser.observe({ sessionId: arguments_.browserId });
    return this.success({ browserId: arguments_.browserId, title: observation.title, url: observation.url });
  }

  private prepareClose(input: {
    conversationId: string;
    projectId: string;
    rawArguments: string;
  }): ToolExecution {
    const arguments_ = browserReferenceArgumentsSchema.parse(parseToolArguments(input.rawArguments));
    this.requireOwnedBrowser(input.conversationId, input.projectId, arguments_.browserId);
    return this.approvedAction(
      "close",
      "The user rejected closing this browser tab.",
      () => Promise.resolve(this.close(input, arguments_)),
    );
  }

  private close(
    input: { conversationId: string },
    arguments_: z.infer<typeof browserReferenceArgumentsSchema>,
  ): ToolExecutionResult {
    this.workspaceTabs.close({
      conversationId: input.conversationId,
      sessionId: arguments_.browserId,
    });
    this.browser.close({ sessionId: arguments_.browserId });
    this.browsers.delete(arguments_.browserId);
    return this.success({ browserId: arguments_.browserId, closed: true });
  }

  private interactionFor(kind: ManagedBrowserInteraction["kind"], rawArguments: unknown): (
    ManagedBrowserInteraction & { browserId: string }
  ) {
    switch (kind) {
      case "click": {
        const value = browserElementArgumentsSchema.parse(rawArguments);
        return { browserId: value.browserId, elementId: value.elementId, kind };
      }
      case "fill": {
        const value = browserFillArgumentsSchema.parse(rawArguments);
        return { browserId: value.browserId, elementId: value.elementId, kind, text: value.text };
      }
      case "select": {
        const value = browserSelectArgumentsSchema.parse(rawArguments);
        return { browserId: value.browserId, elementId: value.elementId, kind, value: value.value };
      }
      case "key": {
        const value = browserKeyArgumentsSchema.parse(rawArguments);
        return { browserId: value.browserId, key: value.key, kind };
      }
      case "scroll": {
        const value = browserScrollArgumentsSchema.parse(rawArguments);
        return { browserId: value.browserId, deltaX: value.deltaX, deltaY: value.deltaY, kind };
      }
    }
  }

  private requireOwnedBrowser(conversationId: string, projectId: string, browserId: string): void {
    const browser = this.browsers.get(browserId);
    if (browser === undefined || browser.conversationId !== conversationId || browser.projectId !== projectId) {
      throw new Error("The browser tab does not belong to this conversation.");
    }
  }

  private approvedAction(
    pattern: string,
    rejectionMessage: string,
    execute: () => Promise<ToolExecutionResult>,
  ): ToolExecution {
    return {
      action: {
        execute,
        pattern,
        permissionTool: "browser_control",
        rejectionMessage,
        rejectionValue: { status: "rejected" },
      },
      content: JSON.stringify({ ok: true, value: { status: "awaiting_approval" } }),
      isError: false,
      kind: "approved_action",
    };
  }

  private success(value: unknown): ToolExecutionResult {
    return { content: JSON.stringify({ ok: true, value }), isError: false, kind: "completed" };
  }
}

function waitFor(timeoutMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, timeoutMs);
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}
