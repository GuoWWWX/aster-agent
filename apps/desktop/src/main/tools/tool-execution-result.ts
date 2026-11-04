import type { ModelMessageAttachment } from "../model/model-contracts.js";

export type ToolExecutionResult = {
  kind: "completed";
  content: string;
  isError: boolean;
  modelAttachments?: ModelMessageAttachment[];
  commandCompletion?: Promise<ToolExecutionResult>;
  status?: "rejected";
};
