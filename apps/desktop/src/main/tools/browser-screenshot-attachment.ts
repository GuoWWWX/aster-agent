import { randomUUID } from "node:crypto";
import type { ManagedBrowserSnapshot } from "@agent/protocol";
import type { ModelMessageAttachment } from "../model/model-contracts.js";

export function browserScreenshotAttachment(snapshot: ManagedBrowserSnapshot, name: string): Extract<ModelMessageAttachment, { kind: "image" }> {
  const sizeBytes = Math.ceil(snapshot.data.length * 0.75);
  return { contextTokens: Math.min(8192, Math.max(1024, Math.ceil(sizeBytes / 2048))), data: snapshot.data,
    id: randomUUID(), kind: "image", mimeType: snapshot.mimeType, name, projectPath: null, readState: "full", source: "browser", truncated: false };
}
