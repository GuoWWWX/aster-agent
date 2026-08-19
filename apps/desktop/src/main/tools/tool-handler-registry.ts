import type { ModelToolDefinition } from "../model/model-contracts.js";
import type { ToolExecution } from "./project-tool-registry.js";
import type { ToolExecutionPolicy } from "./tool-execution-policy.js";

export type { ToolExecutionPolicy } from "./tool-execution-policy.js";

export type ToolAvailabilityContext = {
  projectId: string | undefined;
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
  getDefinitions(): readonly ModelToolDefinition[];
  isAvailable(context: ToolAvailabilityContext): boolean;
};

export class ToolHandlerRegistry<TContext extends ToolHandlerExecutionContext> {
  public constructor(private readonly handlers: readonly ToolHandler<TContext>[]) {}

  public getDefinitions(context: ToolAvailabilityContext): ModelToolDefinition[] {
    const definitions = this.handlers
      .filter((handler) => handler.isAvailable(context))
      .flatMap((handler) => handler.getDefinitions());
    const names = new Set<string>();
    for (const definition of definitions) {
      if (names.has(definition.name)) {
        throw new Error(`Duplicate tool definition: ${definition.name}`);
      }
      names.add(definition.name);
    }
    return [...definitions];
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
    const availableHandlers = this.handlers.filter((handler) =>
      handler.isAvailable(input.context),
    );
    const matches = availableHandlers.filter((handler) =>
      handler.getDefinitions().some((definition) => definition.name === input.toolName),
    );
    if (matches.length === 0) throw new Error(`Unknown tool: ${input.toolName}`);
    if (matches.length > 1) throw new Error(`Multiple handlers registered for: ${input.toolName}`);
    const [match] = matches;
    if (match === undefined) throw new Error(`Unknown tool: ${input.toolName}`);
    return match;
  }
}
