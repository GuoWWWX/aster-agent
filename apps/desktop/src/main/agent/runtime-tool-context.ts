import type {
  ContextCompressionThreshold,
  ConversationPermissionMode,
  ConversationRunEvent,
  ConversationTaskList,
  ModelReasoningOption,
} from "@agent/protocol";

import type { ModelConfiguration } from "../model/model-contracts.js";
import type { ProjectOperationOwner } from "../tools/project-tool-registry.js";
import type { ToolHandlerExecutionContext } from "../tools/tool-handler-registry.js";

export type RuntimeToolContext = ToolHandlerExecutionContext & {
  toolCallId?: string;
  configuration: ModelConfiguration;
  contextCompressionConfiguration: ContextCompressionThreshold;
  emit: (event: ConversationRunEvent) => void;
  onTaskListChanged: (taskList: ConversationTaskList | null) => void;
  operationOwner: ProjectOperationOwner;
  permissionMode: ConversationPermissionMode;
  providerId: string | undefined;
  reasoning: ModelReasoningOption | undefined;
};
