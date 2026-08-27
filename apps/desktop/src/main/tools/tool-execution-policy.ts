/** Maximum number of read tools allowed in one LangGraph parallel window. */
export const MAX_PARALLEL_READ_TOOL_CALLS = 8;

/** Keep explicitly parallel shell processes below the read fan-out. */
export const MAX_PARALLEL_COMMAND_TOOL_CALLS = 4;

export type ToolExecutionPolicy =
  | {
      kind: "parallel";
      group: "command" | "read";
    }
  | {
      kind: "serial";
      prepareBeforeBatch?: boolean;
    };
