import { randomUUID } from "node:crypto";
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

const browserPointFields = {
  x: z.number().int().min(0).max(50_000),
  y: z.number().int().min(0).max(50_000),
} as const;

const browserClickArgumentsSchema = browserReferenceArgumentsSchema.extend({
  button: z.enum(["left", "middle", "right"]).default("left"),
  clickCount: z.union([z.literal(1), z.literal(2)]).default(1),
  elementId: z.string().trim().min(1).max(120).optional(),
  x: browserPointFields.x.optional(),
  y: browserPointFields.y.optional(),
}).strict().superRefine((value, context) => {
  const hasElement = value.elementId !== undefined;
  const hasPoint = value.x !== undefined || value.y !== undefined;
  if (hasElement === hasPoint || (hasPoint && (value.x === undefined || value.y === undefined))) {
    context.addIssue({
      code: "custom",
      message: "Provide exactly one click target: elementId, or both x and y.",
    });
  }
});

const browserMoveArgumentsSchema = browserReferenceArgumentsSchema.extend({
  elementId: z.string().trim().min(1).max(120).optional(),
  x: browserPointFields.x.optional(),
  y: browserPointFields.y.optional(),
}).strict().superRefine((value, context) => {
  const hasElement = value.elementId !== undefined;
  const hasPoint = value.x !== undefined || value.y !== undefined;
  if (hasElement === hasPoint || (hasPoint && (value.x === undefined || value.y === undefined))) {
    context.addIssue({ code: "custom", message: "Provide exactly one move target: elementId, or both x and y." });
  }
});

const browserMouseButtonArgumentsSchema = browserReferenceArgumentsSchema.extend({
  button: z.enum(["left", "middle", "right"]).default("left"),
  ...browserPointFields,
}).strict();

const browserDragArgumentsSchema = browserReferenceArgumentsSchema.extend({
  button: z.enum(["left", "middle", "right"]).default("left"),
  path: z.array(z.object(browserPointFields).strict()).min(2).max(100),
}).strict();

const browserFillArgumentsSchema = browserElementArgumentsSchema.extend({
  text: z.string().max(32_000),
}).strict();

const browserSelectArgumentsSchema = browserElementArgumentsSchema.extend({
  value: z.string().max(4_000),
}).strict();

const browserKeyArgumentsSchema = browserReferenceArgumentsSchema.extend({
  key: z.string().trim().min(1).max(64),
  modifiers: z.array(z.enum(["alt", "control", "meta", "shift"])).max(4).default([]),
}).strict();

const browserTypeArgumentsSchema = browserReferenceArgumentsSchema.extend({
  text: z.string().min(1).max(32_000),
}).strict();

const browserScrollArgumentsSchema = browserReferenceArgumentsSchema.extend({
  deltaX: z.number().int().min(-20_000).max(20_000).default(0),
  deltaY: z.number().int().min(-20_000).max(20_000),
  x: browserPointFields.x.optional(),
  y: browserPointFields.y.optional(),
}).strict();

const browserWaitArgumentsSchema = browserReferenceArgumentsSchema.extend({
  text: z.string().trim().min(1).max(1_000).optional(),
  timeoutMs: z.number().int().min(100).max(30_000).default(1_000),
  urlIncludes: z.string().trim().min(1).max(2_000).optional(),
}).strict();

const browserControlArgumentsSchema = z.object({
  action: z.enum([
    "open",
    "list",
    "observe",
    "screenshot",
    "navigate",
    "back",
    "forward",
    "reload",
    "stop",
    "click",
    "move",
    "mouse_down",
    "mouse_up",
    "drag",
    "fill",
    "type",
    "select",
    "key",
    "scroll",
    "wait",
    "close",
  ]).describe("Browser action to perform."),
  browserId: browserIdSchema.optional()
    .describe("Browser ID returned by action=open/list. Required for every action except open and list."),
  deltaX: z.number().int().min(-20_000).max(20_000).optional()
    .describe("Horizontal pixel delta for action=scroll; defaults to 0."),
  deltaY: z.number().int().min(-20_000).max(20_000).optional()
    .describe("Vertical pixel delta required for action=scroll."),
  button: z.enum(["left", "middle", "right"]).optional()
    .describe("Mouse button for click, mouse_down, mouse_up or drag; defaults to left."),
  clickCount: z.union([z.literal(1), z.literal(2)]).optional()
    .describe("Use 2 for a double-click; defaults to 1."),
  elementId: z.string().trim().min(1).max(120).optional()
    .describe("Fresh element reference returned by observe. Use for click/move when available; required for fill/select."),
  key: z.string().trim().min(1).max(64).optional()
    .describe("Electron accelerator key code for action=key, for example Enter, Tab, A or F5."),
  modifiers: z.array(z.enum(["alt", "control", "meta", "shift"])).max(4).optional()
    .describe("Optional modifier keys for action=key."),
  name: z.string().trim().min(1).max(120).optional()
    .describe("Optional visible tab name for action=open."),
  text: z.string().max(32_000).optional()
    .describe("Replacement text for fill, keyboard text for type, or visible text condition for wait."),
  timeoutMs: z.number().int().min(100).max(30_000).optional()
    .describe("Wait duration for action=wait; defaults to 1000."),
  url: z.string().trim().min(1).max(8_192).optional()
    .describe("HTTP/HTTPS URL or search text required for open and navigate."),
  value: z.string().max(4_000).optional()
    .describe("Option value required for action=select."),
  x: browserPointFields.x.optional()
    .describe("Screenshot pixel X coordinate for pointer actions, or optional scroll anchor."),
  y: browserPointFields.y.optional()
    .describe("Screenshot pixel Y coordinate for pointer actions, or optional scroll anchor."),
  path: z.array(z.object(browserPointFields).strict()).min(2).max(100).optional()
    .describe("Ordered screenshot-coordinate path required for action=drag."),
  urlIncludes: z.string().trim().min(1).max(2_000).optional()
    .describe("Optional URL substring condition for action=wait."),
}).strict();

export const BROWSER_PLUGIN_ID = "agent.browser";
export const BROWSER_TOOL_NAMES = {
  control: "browser_control",
  // Legacy names remain executable for compatibility callers. New model
  // requests receive only browser_control from getDefinitions().
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
        description: "Control the isolated, user-visible browser through one bounded action surface. Load the browser-use Skill before non-trivial browser work. Prefer observe plus elementId because semantic targets are more reliable; use screenshot plus pixel coordinates for canvas, icon-only or otherwise unobservable targets. Coordinates are CSS pixels in the returned screenshot. Observe again after page changes because element references expire. Supports navigation, screenshots, real mouse clicks/movement/dragging, keyboard input, scrolling, form controls and waits. HTTP/HTTPS only; permission prompts and arbitrary page JavaScript are blocked.",
        name: BROWSER_TOOL_NAMES.control,
        parameters: modelToolParameters(browserControlArgumentsSchema),
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
        case BROWSER_TOOL_NAMES.control:
          return await this.executeControl(projectInput);
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

  private async executeControl(input: {
    conversationId: string;
    projectId: string;
    rawArguments: string;
    signal: AbortSignal;
  }): Promise<ToolExecution> {
    const arguments_ = browserControlArgumentsSchema.parse(parseToolArguments(input.rawArguments));
    const forwarded = (value: Record<string, unknown>): typeof input => ({
      ...input,
      rawArguments: JSON.stringify(value),
    });
    switch (arguments_.action) {
      case "open":
        return this.prepareOpen(forwarded({ name: arguments_.name, url: arguments_.url }));
      case "list":
        return this.list(input.conversationId, input.projectId);
      case "observe":
        return this.observe(forwarded({ browserId: arguments_.browserId }));
      case "screenshot":
        return this.screenshot(forwarded({ browserId: arguments_.browserId }));
      case "navigate":
        return this.prepareNavigate(forwarded({ browserId: arguments_.browserId, url: arguments_.url }));
      case "back":
      case "forward":
      case "reload":
      case "stop":
        return this.prepareNavigationCommand(
          forwarded({ browserId: arguments_.browserId }),
          arguments_.action,
        );
      case "click":
        return this.prepareInteraction(forwarded({
          browserId: arguments_.browserId,
          button: arguments_.button,
          clickCount: arguments_.clickCount,
          elementId: arguments_.elementId,
          x: arguments_.x,
          y: arguments_.y,
        }), "click");
      case "move":
        return this.prepareInteraction(forwarded({
          browserId: arguments_.browserId,
          elementId: arguments_.elementId,
          x: arguments_.x,
          y: arguments_.y,
        }), "move");
      case "mouse_down":
        return this.prepareInteraction(forwarded({
          browserId: arguments_.browserId,
          button: arguments_.button,
          x: arguments_.x,
          y: arguments_.y,
        }), "mouseDown");
      case "mouse_up":
        return this.prepareInteraction(forwarded({
          browserId: arguments_.browserId,
          button: arguments_.button,
          x: arguments_.x,
          y: arguments_.y,
        }), "mouseUp");
      case "drag":
        return this.prepareInteraction(forwarded({
          browserId: arguments_.browserId,
          button: arguments_.button,
          path: arguments_.path,
        }), "drag");
      case "fill":
        return this.prepareInteraction(forwarded({
          browserId: arguments_.browserId,
          elementId: arguments_.elementId,
          text: arguments_.text,
        }), "fill");
      case "type":
        return this.prepareInteraction(forwarded({
          browserId: arguments_.browserId,
          text: arguments_.text,
        }), "type");
      case "select":
        return this.prepareInteraction(forwarded({
          browserId: arguments_.browserId,
          elementId: arguments_.elementId,
          value: arguments_.value,
        }), "select");
      case "key":
        return this.prepareInteraction(forwarded({
          browserId: arguments_.browserId,
          key: arguments_.key,
          modifiers: arguments_.modifiers,
        }), "key");
      case "scroll":
        return this.prepareInteraction(forwarded({
          browserId: arguments_.browserId,
          deltaX: arguments_.deltaX ?? 0,
          deltaY: arguments_.deltaY,
          x: arguments_.x,
          y: arguments_.y,
        }), "scroll");
      case "wait":
        return this.wait(forwarded({
          browserId: arguments_.browserId,
          text: arguments_.text,
          timeoutMs: arguments_.timeoutMs ?? 1_000,
          urlIncludes: arguments_.urlIncludes,
        }));
      case "close":
        return this.prepareClose(forwarded({ browserId: arguments_.browserId }));
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

  private list(conversationId: string, projectId: string): ToolExecutionResult {
    const sessions = [...this.browsers.entries()].flatMap(([browserId, owner]) => {
      if (owner.conversationId !== conversationId || owner.projectId !== projectId) return [];
      try {
        return [this.browser.getSession({ sessionId: browserId })];
      } catch {
        this.browsers.delete(browserId);
        return [];
      }
    });
    return this.success({ sessions });
  }

  private async screenshot(input: {
    conversationId: string;
    projectId: string;
    rawArguments: string;
  }): Promise<ToolExecutionResult> {
    const arguments_ = browserReferenceArgumentsSchema.parse(parseToolArguments(input.rawArguments));
    this.requireOwnedBrowser(input.conversationId, input.projectId, arguments_.browserId);
    const snapshot = await this.browser.capture({ sessionId: arguments_.browserId });
    const attachmentId = randomUUID();
    const sizeBytes = Math.ceil(snapshot.data.length * 0.75);
    return {
      content: JSON.stringify({
        ok: true,
        value: {
          browserId: arguments_.browserId,
          coordinateSpace: "screenshot_css_pixels",
          height: snapshot.height,
          mimeType: snapshot.mimeType,
          width: snapshot.width,
        },
      }),
      isError: false,
      kind: "completed",
      modelAttachments: [{
        contextTokens: Math.min(8_192, Math.max(1_024, Math.ceil(sizeBytes / 2_048))),
        data: snapshot.data,
        id: attachmentId,
        kind: "image",
        mimeType: snapshot.mimeType,
        name: `browser-${arguments_.browserId}.jpg`,
        projectPath: null,
        readState: "full",
        source: "browser",
        truncated: false,
      }],
    };
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

  private prepareNavigationCommand(
    input: { conversationId: string; projectId: string; rawArguments: string },
    action: "back" | "forward" | "reload" | "stop",
  ): ToolExecution {
    const arguments_ = browserReferenceArgumentsSchema.parse(parseToolArguments(input.rawArguments));
    this.requireOwnedBrowser(input.conversationId, input.projectId, arguments_.browserId);
    return this.approvedAction(
      action,
      `The user rejected browser action ${action}.`,
      async () => {
        const reference = { sessionId: arguments_.browserId };
        if (action === "back") this.browser.back(reference);
        else if (action === "forward") this.browser.forward(reference);
        else if (action === "reload") await this.browser.reload(reference);
        else this.browser.stop(reference);
        return this.success({ browserId: arguments_.browserId, performed: action });
      },
    );
  }

  private prepareInteraction(
    input: { conversationId: string; projectId: string; rawArguments: string },
    kind: ManagedBrowserInteraction["kind"],
  ): ToolExecution {
    const rawArguments = parseToolArguments(input.rawArguments);
    const interaction = this.interactionFor(kind, rawArguments);
    this.requireOwnedBrowser(input.conversationId, input.projectId, interaction.browserId);
    const { browserId, ...action } = interaction;
    return this.approvedAction(
      browserInteractionPermissionPattern(action),
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
    const hasCondition = arguments_.text !== undefined || arguments_.urlIncludes !== undefined;
    const deadline = Date.now() + arguments_.timeoutMs;
    let observation = await this.browser.observe({ sessionId: arguments_.browserId });
    while (hasCondition && !browserWaitMatches(observation, arguments_)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error("Browser wait timed out before the requested condition was visible.");
      }
      await waitFor(Math.min(250, remaining), input.signal);
      observation = await this.browser.observe({ sessionId: arguments_.browserId });
    }
    if (!hasCondition) {
      await waitFor(arguments_.timeoutMs, input.signal);
      observation = await this.browser.observe({ sessionId: arguments_.browserId });
    }
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
        const value = browserClickArgumentsSchema.parse(rawArguments);
        if (value.elementId === undefined && (value.x === undefined || value.y === undefined)) {
          throw new Error("A coordinate click requires both x and y.");
        }
        return {
          browserId: value.browserId,
          button: value.button,
          clickCount: value.clickCount,
          ...(value.elementId === undefined
            ? { x: value.x!, y: value.y! }
            : { elementId: value.elementId }),
          kind,
        };
      }
      case "move": {
        const value = browserMoveArgumentsSchema.parse(rawArguments);
        if (value.elementId === undefined && (value.x === undefined || value.y === undefined)) {
          throw new Error("A coordinate move requires both x and y.");
        }
        return {
          browserId: value.browserId,
          ...(value.elementId === undefined
            ? { x: value.x!, y: value.y! }
            : { elementId: value.elementId }),
          kind,
        };
      }
      case "mouseDown":
      case "mouseUp": {
        const value = browserMouseButtonArgumentsSchema.parse(rawArguments);
        return {
          browserId: value.browserId,
          button: value.button,
          kind,
          x: value.x,
          y: value.y,
        };
      }
      case "drag": {
        const value = browserDragArgumentsSchema.parse(rawArguments);
        return {
          browserId: value.browserId,
          button: value.button,
          kind,
          path: value.path,
        };
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
        return { browserId: value.browserId, key: value.key, kind, modifiers: value.modifiers };
      }
      case "type": {
        const value = browserTypeArgumentsSchema.parse(rawArguments);
        return { browserId: value.browserId, kind, text: value.text };
      }
      case "scroll": {
        const value = browserScrollArgumentsSchema.parse(rawArguments);
        return {
          browserId: value.browserId,
          deltaX: value.deltaX,
          deltaY: value.deltaY,
          kind,
          ...(value.x === undefined || value.y === undefined ? {} : { x: value.x, y: value.y }),
        };
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

function browserWaitMatches(
  observation: { text: string; url: string },
  condition: { text?: string | undefined; urlIncludes?: string | undefined },
): boolean {
  return (condition.text === undefined || observation.text.includes(condition.text))
    && (condition.urlIncludes === undefined || observation.url.includes(condition.urlIncludes));
}

function browserInteractionPermissionPattern(action: ManagedBrowserInteraction): string {
  switch (action.kind) {
    case "click":
      return action.elementId === undefined
        ? `click ${action.button} ${action.clickCount} ${action.x},${action.y}`
        : `click ${action.button} ${action.clickCount} ${action.elementId}`;
    case "move":
      return action.elementId === undefined
        ? `move ${action.x},${action.y}`
        : `move ${action.elementId}`;
    case "mouseDown":
    case "mouseUp":
      return `${action.kind} ${action.button} ${action.x},${action.y}`;
    case "drag":
      return `drag ${action.button} ${action.path.map((point) => `${point.x},${point.y}`).join(" ")}`;
    case "fill":
    case "select":
      return `${action.kind} ${action.elementId}`;
    case "type":
      return "type focused-element";
    case "key":
      return `key ${[...action.modifiers, action.key].join("+")}`;
    case "scroll":
      return `scroll ${action.deltaX},${action.deltaY} ${action.x ?? "center"},${action.y ?? "center"}`;
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}
