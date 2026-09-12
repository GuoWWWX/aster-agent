import type { BackendSendCommand } from "./backend-command.js";

export type BackendCommandRuntime = {
  sendMessage: (input: {
    attachmentIds: string[];
    content: string;
    conversationId: string;
  }, onEvent: (event: unknown) => void) => { kind: "started"; runId: string } | { kind: "pending"; pendingMessage: { id: string } };
};

export function dispatchBackendSendCommand(
  command: BackendSendCommand,
  runtime: BackendCommandRuntime,
  onEvent: (event: unknown) => void,
): string {
  const submission = runtime.sendMessage({
    attachmentIds: [],
    content: command.content,
    conversationId: command.conversationId,
  }, onEvent);
  return submission.kind === "started" ? submission.runId : submission.pendingMessage.id;
}
