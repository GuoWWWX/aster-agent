import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseToolArguments } from "../model/tool-arguments.js";
import { toolErrorContent } from "./tool-error.js";

const toolRecoverySchema = z.object({
  action: z.enum(["fix_arguments", "reread_and_rebuild_change"]),
  instruction: z.string(),
  issues: z.array(z.object({
    code: z.string(),
    message: z.string(),
    path: z.array(z.union([z.string(), z.number()])),
  }).strict()).optional(),
  retryable: z.boolean(),
}).strict();

const toolErrorPayloadSchema = z.object({
  agentError: z.object({
    code: z.string(),
    retryable: z.boolean(),
  }).passthrough(),
  error: z.string(),
  ok: z.literal(false),
  recovery: toolRecoverySchema.optional(),
}).passthrough();

describe("tool errors", () => {
  it("returns bounded field-level recovery details for invalid arguments", () => {
    const parsed = z.object({
      commandIds: z.array(z.string().uuid()).min(1),
      timeoutMs: z.number().int().min(1_000),
    }).strict().safeParse({
      commandIds: ["not-a-uuid"],
      timeoutMs: 10,
    });
    if (parsed.success) throw new Error("Expected tool arguments to be invalid.");

    const payload = toolErrorPayloadSchema.parse(
      JSON.parse(toolErrorContent(parsed.error, "tool:wait_for_commands")),
    );

    expect(payload.recovery).toMatchObject({
      action: "fix_arguments",
      retryable: true,
    });
    expect(payload.recovery?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["commandIds", 0] }),
      expect.objectContaining({ path: ["timeoutMs"] }),
    ]));
    expect(payload.recovery?.issues).toHaveLength(2);
  });

  it("tells the model to correct malformed JSON arguments", () => {
    let reason: unknown;
    try {
      parseToolArguments("{broken");
    } catch (error) {
      reason = error;
    }
    const payload = toolErrorPayloadSchema.parse(
      JSON.parse(toolErrorContent(reason, "tool:read_file")),
    );

    expect(payload.recovery).toEqual({
      action: "fix_arguments",
      instruction: "根据 issues 修正本次工具参数后重试；不要重复提交相同参数。",
      issues: [{
        code: "invalid_json",
        message: "Tool arguments must be valid JSON.",
        path: [],
      }],
      retryable: true,
    });
  });

  it("bounds hostile validation issue paths and messages", () => {
    const reason = {
      issues: Array.from({ length: 20 }, () => ({
        code: "x".repeat(500),
        message: "m".repeat(2_000),
        path: Array.from({ length: 30 }, () => "p".repeat(500)),
      })),
    };
    const payload = toolErrorPayloadSchema.parse(
      JSON.parse(toolErrorContent(reason, "tool:test")),
    );
    const issues = payload.recovery?.issues ?? [];

    expect(issues).toHaveLength(8);
    expect(issues[0]?.code.length).toBe(80);
    expect(issues[0]?.message.length).toBe(300);
    expect(issues[0]?.path).toHaveLength(16);
    expect(issues[0]?.path[0]).toHaveLength(120);
  });

  it("tells the model to discard a stale file change and read the latest content", () => {
    const payload = toolErrorPayloadSchema.parse(
      JSON.parse(toolErrorContent(
        Object.assign(new Error("The file changed after the diff was generated."), {
          code: "FILE_CHANGED",
        }),
        "tool:file_change",
      )),
    );

    expect(payload.agentError).toMatchObject({ code: "FILE_CHANGED", retryable: true });
    expect(payload.recovery).toMatchObject({
      action: "reread_and_rebuild_change",
      retryable: true,
    });
    expect(payload.recovery?.instruction).toContain("不能排队或重试相同参数");
  });
});
