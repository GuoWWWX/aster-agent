import { describe, expect, it } from "vitest";
import { saveScheduledTaskIpcArgumentsSchema, scheduledTaskReferenceIpcArgumentsSchema } from "./scheduled-task.js";
const input = { name: "检查", prompt: "检查项目", enabled: true, projectId: null, agentId: null,
  permissionMode: "ask_before_changes", recurrence: { kind: "daily", time: "09:00", timezone: "Asia/Tokyo" } };
describe("scheduled task IPC schemas", () => {
  it("accepts complete configuration and reference inputs", () => {
    expect(saveScheduledTaskIpcArgumentsSchema.parse([input])[0].name).toBe("检查");
    expect(scheduledTaskReferenceIpcArgumentsSchema.parse([{ id: "00000000-0000-4000-8000-000000000001" }])).toHaveLength(1);
  });
  it.each([{ ...input, name: " " }, { ...input, prompt: "" }, { ...input, permissionMode: "bypass" },
    { ...input, recurrence: { kind: "daily", time: "24:00", timezone: "UTC" } },
    { ...input, recurrence: { kind: "daily", time: "09:00", timezone: "invalid" } },
    { ...input, recurrence: { kind: "weekly", time: "09:00", timezone: "UTC", weekdays: [1, 1] } },
    { ...input, recurrence: { kind: "once", at: "not-a-date" } }, { ...input, rootPath: "C:\\arbitrary" },
  ])("rejects invalid or extra configuration", (value) => { expect(() => saveScheduledTaskIpcArgumentsSchema.parse([value])).toThrow(); });
  it("rejects invalid and extra reference fields", () => {
    expect(() => scheduledTaskReferenceIpcArgumentsSchema.parse([{ id: "bad" }])).toThrow();
    expect(() => scheduledTaskReferenceIpcArgumentsSchema.parse([{ id: "00000000-0000-4000-8000-000000000001", prompt: "injected" }])).toThrow();
  });
});
