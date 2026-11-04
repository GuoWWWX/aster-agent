// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userQuestionSchema, type ConversationRunEvent } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/index.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { UserQuestionPanel } from "./user-question-panel.js";

let root: Root | undefined;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); vi.spyOn(document, "hasFocus").mockReturnValue(false); });
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const id = "00000000-0000-4000-8000-000000000001";
const question = () => userQuestionSchema.parse({ id: "00000000-0000-4000-8000-000000000002", conversationId: id, displayConversationId: id, runId: "00000000-0000-4000-8000-000000000003", toolCallId: "ask", sourceTitle: "测试代理", questions: [{ id: "scope", title: "页面范围", question: "检查哪些页面？", options: [{ label: "设置页面", description: "检查配置与保存" }, { label: "全部页面" }] }], status: "pending", answers: null, createdAt: "2026-10-14T01:00:00Z", answeredAt: null, viewed: false });
async function render(client: MockAgentClient): Promise<HTMLDivElement> {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<TooltipProvider><UserQuestionPanel agentClient={client} conversationId={id} active /></TooltipProvider>); await Promise.resolve(); });
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
  expect(container.querySelector("textarea")?.value).toBe("");
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
  expect(container.querySelector('[hidden]')?.querySelector("textarea")).not.toBeNull(); expect(viewed).not.toHaveBeenCalled();
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

it("shows the recommendation and lets free text replace or deselect a choice", async () => {
  const client = new MockAgentClient(); const q = question();
  q.questions[0]!.options[0]!.recommended = true;
  vi.spyOn(client, "listUserQuestions").mockResolvedValue([q]);
  const answer = vi.spyOn(client, "answerUserQuestion").mockRejectedValue(new Error("fixture retry"));
  const container = await render(client);
  expect(container.querySelector('[data-user-question-panel]')).not.toBeNull();
  expect(container.textContent).toContain("AI 推荐");
  const choice = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.startsWith("设置页面"))!;
  act(() => choice.click());
  act(() => choice.click());
  expect(choice.getAttribute("aria-pressed")).toBe("false");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  const textarea = container.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "我自己决定的范围");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
  expect(answer).toHaveBeenCalledWith({ questionId: q.id, answers: { scope: "我自己决定的范围" } });
});

it("pastes an image into the answer, previews it, and submits its ID to the question owner", async () => {
  const client = new MockAgentClient(); const q = question();
  q.conversationId = "00000000-0000-4000-8000-000000000005";
  const attachment = { id: "00000000-0000-4000-8000-000000000006", conversationId: q.conversationId,
    name: "answer.png", kind: "image" as const, mimeType: "image/png", source: "upload" as const,
    contextTokens: 1, sizeBytes: 3, truncated: false, projectPath: null, messageId: null, createdAt: q.createdAt };
  vi.spyOn(client, "listUserQuestions").mockResolvedValue([q]);
  const ordinaryDraft = { ...attachment, id: "00000000-0000-4000-8000-000000000007", name: "ordinary-draft.png" };
  vi.spyOn(client, "listDraftConversationAttachments").mockResolvedValue([ordinaryDraft]);
  const importBytes = vi.spyOn(client, "importConversationAttachmentBytes").mockResolvedValue([ordinaryDraft, attachment]);
  vi.spyOn(client, "readConversationAttachmentPreview").mockResolvedValue({ data: "AQID", mimeType: "image/png" });
  const answer = vi.spyOn(client, "answerUserQuestion").mockResolvedValue({ ...q, answers: { scope: "请参考回答附件。" }, answerAttachmentIds: [attachment.id], status: "answered", answeredAt: q.createdAt, deliveryComplete: true });
  const container = await render(client);
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", { value: { files: [new File([Uint8Array.of(1, 2, 3)], "answer.png", { type: "image/png" })], items: [] } });
  await act(async () => {
    container.querySelector("textarea")!.dispatchEvent(paste);
    for (let index = 0; index < 5; index++) await new Promise(resolve => window.setTimeout(resolve, 0));
  });
  expect(paste.defaultPrevented).toBe(true);
  expect(importBytes).toHaveBeenCalledWith({ conversationId: q.conversationId, base64: "AQID", name: "answer.png", mimeType: "image/png" });
  expect(container.querySelector('img[alt="answer.png"]')).not.toBeNull();
  expect(container.textContent).not.toContain("ordinary-draft.png");
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
  expect(answer).toHaveBeenCalledWith({ questionId: q.id, answers: { scope: "请参考回答附件。" }, attachmentIds: [attachment.id] });
});
