import { parentPort } from "node:worker_threads";
import { z } from "zod";
import { ThreadLog } from "./thread-log.js";
import { buildThreadLogReadIndexes, type ThreadLogReadIndexes } from "./thread-log-read-index.js";

const requestSchema = z.object({ requestId: z.number().int().positive(), root: z.string().min(1), conversationId: z.string().uuid() }).strict();
export type ThreadLogReaderResponse = { requestId: number } & ({ ok: true; snapshot: ThreadLogReadIndexes | null } | { ok: false; error: string });

parentPort?.on("message", (message: unknown) => {
  const request = requestSchema.parse(message);
  try {
    const log = new ThreadLog(request.root, { readOnly: true });
    const snapshot = buildThreadLogReadIndexes(log, request.conversationId);
    parentPort?.postMessage({ requestId: request.requestId, ok: true, snapshot } satisfies ThreadLogReaderResponse);
  } catch (error) {
    parentPort?.postMessage({ requestId: request.requestId, ok: false,
      error: error instanceof Error ? error.message : "Conversation read failed." } satisfies ThreadLogReaderResponse);
  }
});
