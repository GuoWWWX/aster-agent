import type { ModelToolDefinition } from "../model/model-contracts.js";
import type { ToolExecution } from "./project-tool-registry.js";
import type { ToolExecutionPolicy } from "./tool-execution-policy.js";

export type { ToolExecutionPolicy } from "./tool-execution-policy.js";

export type ToolAvailabilityContext = {
  conversationId?: string;
  projectId: string | undefined;
  toolName?: string;
};

export type ToolHandlerExecutionContext = {
  conversationId: string;
  projectId: string | undefined;
  runId: string;
  signal: AbortSignal;
};

export type ToolHandlerInput<TContext extends ToolHandlerExecutionContext> = {
  context: TContext;
  rawArguments: string;
  toolName: string;
};

export type ToolHandler<TContext extends ToolHandlerExecutionContext> = {
  execute(input: ToolHandlerInput<TContext>): Promise<ToolExecution>;
  getExecutionPolicy?(input: ToolHandlerInput<TContext>): ToolExecutionPolicy;
  getDefinitions(context: ToolAvailabilityContext): readonly ModelToolDefinition[];
  isAvailable(context: ToolAvailabilityContext): boolean;
};

export class ToolHandlerRegistry<TContext extends ToolHandlerExecutionContext> {
  public constructor(
    private readonly handlers: readonly ToolHandler<TContext>[],
    private readonly allowedTools: (context: ToolAvailabilityContext) => ReadonlySet<string> | null = () => null,
  ) {}

  public getDefinitions(context: ToolAvailabilityContext): ModelToolDefinition[] {
    const allowed = this.allowedTools(context);
    const definitions = this.handlers
      .filter((handler) => handler.isAvailable(context))
      .flatMap((handler) => handler.getDefinitions(context).filter(tool =>
        (allowed === null || allowed.has(tool.name)) && handler.isAvailable({ ...context, toolName: tool.name })));
    const names = new Set<string>();
    for (const definition of definitions) {
      if (names.has(definition.name)) {
        throw new Error(`Duplicate tool definition: ${definition.name}`);
      }
      names.add(definition.name);
    }
    return [...definitions].sort((left, right) => left.name.localeCompare(right.name));
  }

  public async execute(input: {
    context: TContext;
    rawArguments: string;
    toolName: string;
  }): Promise<ToolExecution> {
    return this.findHandler(input).execute(input);
  }

  public getExecutionPolicy(input: ToolHandlerInput<TContext>): ToolExecutionPolicy {
    const handler = this.findHandler(input);
    return handler.getExecutionPolicy?.(input) ?? { kind: "serial" };
  }

  private findHandler(input: ToolHandlerInput<TContext>): ToolHandler<TContext> {
    const allowed = this.allowedTools(input.context);
    if (allowed !== null && !allowed.has(input.toolName)) throw new Error(`Unknown tool: ${input.toolName}`);
    const availableHandlers = this.handlers.filter((handler) =>
      handler.isAvailable({
        conversationId: input.context.conversationId,
        projectId: input.context.projectId,
        toolName: input.toolName,
      }),
    );
    const matches = availableHandlers.filter((handler) =>
      handler.getDefinitions(input.context).some((definition) => definition.name === input.toolName),
    );
    if (matches.length === 0) throw new Error(`Unknown tool: ${input.toolName}`);
    if (matches.length > 1) throw new Error(`Multiple handlers registered for: ${input.toolName}`);
    const [match] = matches;
    if (match === undefined) throw new Error(`Unknown tool: ${input.toolName}`);
    return match;
  }
}
