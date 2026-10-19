import { randomUUID } from "node:crypto";
import type { AgentErrorCode } from "@agent/protocol";

/** A feature conflict keeps actionable guidance through the existing error envelope. */
export class CollaborationError extends Error {
  public readonly id = randomUUID();
  public readonly code: AgentErrorCode;
  public readonly retryable: boolean;
  public readonly details: { operation: string; reason: string };
  public constructor(reason: string, message: string) {
    super(`${reason}: ${message}`);
    this.code = reason.endsWith("NOT_FOUND") ? "ARTIFACT_NOT_FOUND"
      : ["TASK_SCOPE", "TASK_OWNER", "TEAM_SCOPE", "TEAM_MEMBER"].includes(reason) ? "PERMISSION_DENIED" : "CONFLICT";
    this.retryable = reason === "TASK_REVISION_CONFLICT";
    this.details = { operation: "collaboration", reason };
  }
}
