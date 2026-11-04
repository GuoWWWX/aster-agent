import { expect, it } from "vitest";
import type { ModelMessage } from "./model-contracts.js";
import { withLatestRuntimeContextAtTail } from "./model-runtime-context.js";

const message = (content: string): ModelMessage => ({ role: "user", content, attachments: [], toolCalls: [], toolCallId: null });

it("keeps real history in order and only the latest snapshot of each kind in a deterministic tail", () => {
  const source = [message("request"), { ...message("directory old"), runtimeContext: "directory" as const },
    { ...message("skill old"), runtimeContext: "skills" as const }, { ...message("evidence"), role: "tool" as const, toolCallId: "call" },
    message("steer"), { ...message("skill current"), runtimeContext: "skills" as const }, { ...message("directory current"), runtimeContext: "directory" as const }];
  const original = structuredClone(source);
  expect(withLatestRuntimeContextAtTail(source).map(item => item.content)).toEqual(["request", "evidence", "steer", "skill current", "directory current"]);
  expect(source).toEqual(original);
});

it("retains an explicit empty snapshot and never moves untagged references or media inputs", () => {
  const image: ModelMessage = { ...message("current image"), runtimeContext: "skills", attachments: [{ id: "image", contextTokens: 100, kind: "image", data: "eA==", mimeType: "image/png", name: "image.png", projectPath: null, source: "upload", readState: "full", truncated: false }] };
  const source = [{ ...message("active"), runtimeContext: "skills" as const }, message("directory is user text"), image,
    { ...message("No active entries"), runtimeContext: "skills" as const }];
  expect(withLatestRuntimeContextAtTail(source)).toEqual([source[1], image, source[3]]);
  expect(withLatestRuntimeContextAtTail([])).toEqual([]);
});
