// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userQuestionSchema, type ConversationRunEvent } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/index.js";
import { UserQuestionPanel } from "./user-question-panel.js";

let root: Root | undefined;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.spyOn(document, "hasFocus").mockReturnValue(false); });
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });
const id = "00000000-0000-4000-8000-000000000001";
const question = () => userQuestionSchema.parse({ id: "00000000-0000-4000-8000-000000000002", conversationId: id, displayConversationId: id, runId: "00000000-0000-4000-8000-000000000003", toolCallId: "ask", sourceTitle: "测试代理", questions: [{ id: "scope", title: "页面范围", question: "检查哪些页面？", options: [{ label: "设置页面", description: "检查配置与保存" }, { label: "全部页面" }] }], status: "pending", answers: null, createdAt: "2026-10-14T01:00:00Z", answeredAt: null, viewed: false });
async function render(client: MockAgentClient): Promise<HTMLDivElement> {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<UserQuestionPanel agentClient={client} conversationId={id} active />); await Promise.resolve(); });
  return container;
}
it("offers choices and free text, does not submit a selected choice until explicitly sent", async () => {
  const client = new MockAgentClient(); const q = question();
  vi.spyOn(client, "listUserQuestions").mockResolvedValue([q]);
  const answer = vi.spyOn(client, "answerUserQuestion").mockResolvedValue({ ...q, answers: { scope: "设置页面" }, status: "answered", answeredAt: "2026-10-14T02:00:00Z", viewed: true, deliveryComplete: true });
  const container = await render(client);
  const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(submit.disabled).toBe(true);
  await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.startsWith("设置页面"))!.click(); await Promise.resolve(); });
  expect(submit.disabled).toBe(false); expect(answer).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")?.value).toBe("设置页面");
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
  expect(answer).toHaveBeenCalledWith({ questionId: q.id, answers: { scope: "设置页面" } });
  expect(container.textContent).not.toContain("需要你的回答");
});
it("keeps other work available when collapsed and restores a new child question from events", async () => {
  const client = new MockAgentClient(); const q = question();
  let listener: ((event: ConversationRunEvent) => void) | undefined;
  vi.spyOn(client, "listUserQuestions").mockResolvedValue([q]);
  vi.spyOn(client, "onConversationRunEvent").mockImplementation((value) => { listener = value; return () => undefined; });
  const viewed = vi.spyOn(client, "markUserQuestionViewed"); const container = await render(client);
  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click(); await Promise.resolve(); });
  expect(container.querySelector("textarea")).toBeNull(); expect(viewed).not.toHaveBeenCalled();
  const child = { ...q, id: "00000000-0000-4000-8000-000000000004", conversationId: "00000000-0000-4000-8000-000000000005", sourceTitle: "前端代理" };
  await act(async () => { listener?.({ type: "user_question.updated", reason: "created", conversationId: id, question: child }); await Promise.resolve(); });
  expect(container.textContent).toContain("来自 前端代理"); expect(container.querySelectorAll("textarea")).toHaveLength(2);
});
it("retries a saved answer without allowing it to be silently replaced", async () => {
  const client = new MockAgentClient(); const q = { ...question(), status: "answered" as const, answers: { scope: "自定义范围" }, answeredAt: "2026-10-14T02:00:00Z", viewed: true };
  vi.spyOn(client, "listUserQuestions").mockResolvedValue([q]);
  const answer = vi.spyOn(client, "answerUserQuestion").mockRejectedValue(new Error("模型未配置")); const container = await render(client);
  expect(container.querySelector("fieldset")?.disabled).toBe(true);
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
  expect(answer).toHaveBeenCalledWith({ questionId: q.id, answers: { scope: "自定义范围" } });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("模型未配置");
  expect(container.textContent).toContain("重试送达");
});
