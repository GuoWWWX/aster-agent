import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { UserQuestion } from "@agent/protocol";
import { AgentDatabase } from "../storage/agent-database.js";
import { UserQuestionService } from "./user-question-service.js";
import { UserQuestionTool } from "./user-question-tool.js";

const databases: AgentDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
function fixture() {
  const database = new AgentDatabase(":memory:"); databases.push(database);
  const conversation = database.createConversation(null); const records = new Map<string, UserQuestion>();
  const save = vi.fn((q: UserQuestion) => { records.set(q.id, q); });
  const service = new UserQuestionService({ conversation: id => database.getConversation(id), list: () => [...records.values()],
    get: id => { const q = records.get(id); if (!q) throw new Error("Missing question"); return q; }, save,
    delivered: () => false, validateAttachments: () => undefined, deliver: () => undefined });
  const tool = new UserQuestionTool(service);
  const execute = (options?: unknown[]) => tool.execute({ toolName: "request_user_input", conversationId: conversation.id,
    runId: randomUUID(), toolCallId: randomUUID(), signal: new AbortController().signal, emit: vi.fn(),
    rawArguments: JSON.stringify({ questions: [{ id: "format", title: "导出", question: "怎样导出报表？", ...(options === undefined ? {} : { options }) }] }) });
  return { tool, execute, records, save };
}
it("stores complete option text as a label with one explicit recommendation", async () => {
  const f = fixture();
  const parameters = f.tool.getDefinitions().find(definition => definition.name === "request_user_input")?.parameters;
  expect(parameters).toHaveProperty("properties.questions.items.properties.options.items.required", ["text", "recommended"]);
  expect(parameters).toHaveProperty("properties.questions.items.properties.options.items.additionalProperties", false);
  await f.execute([{ text: "导出为 Markdown 文件。", recommended: true }, { text: "导出为 JSON 文件。", recommended: false }]);
  expect([...f.records.values()][0]?.questions[0]?.options).toEqual([
    { label: "导出为 Markdown 文件。", recommended: true }, { label: "导出为 JSON 文件。", recommended: false },
  ]);
});
it("rejects missing, zero or multiple recommendation flags before publishing a question", async () => {
  const f = fixture();
  for (const options of [
    [{ text: "导出为 Markdown 文件。" }, { text: "导出为 JSON 文件。" }],
    [{ text: "导出为 Markdown 文件。", recommended: false }, { text: "导出为 JSON 文件。", recommended: false }],
    [{ text: "导出为 Markdown 文件。", recommended: true }, { text: "导出为 JSON 文件。", recommended: true }],
    [{ label: "Markdown", description: "导出报表", recommended: true }],
  ]) {
    const execution = f.execute(options);
    await expect(execution).rejects.toMatchObject({ code: "TOOL_ARGUMENTS_INVALID" });
    await expect(execution).rejects.toThrow("recommended");
  }
  expect(f.save).not.toHaveBeenCalled(); expect(f.records.size).toBe(0);
});
it("still supports a question with only free-text input", async () => {
  const f = fixture(); await f.execute();
  expect([...f.records.values()][0]?.questions[0]?.options).toEqual([]);
});
