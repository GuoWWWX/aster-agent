import { serializeAgentError } from "@agent/protocol";

import { reportMainError, toMainAgentError } from "../errors/agent-error.js";

export async function runIpcHandler<Result>(
  channel: string,
  handler: () => Result | Promise<Result>,
): Promise<Result> {
  try {
    return await handler();
  } catch (reason) {
    const error = toMainAgentError(reason, { operation: `ipc:${channel}` });
    reportMainError(error, reason);
    throw new Error(serializeAgentError(error), { cause: reason });
  }
}
