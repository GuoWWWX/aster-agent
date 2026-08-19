export type ToolExecutionPolicy =
  | {
      kind: "parallel";
      group: "command" | "read";
    }
  | {
      kind: "serial";
      prepareBeforeBatch?: boolean;
    };
