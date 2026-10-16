// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationAttachment } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { createProjectSession } from "../projects/project-session-model.js";
import { ConversationWorkspace } from "./workspace-content.js";

let root: Root | undefined;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useWorkbenchUiStore.setState({ activeActivity: "conversations" });
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await new Promise(resolve => window.setTimeout(resolve, 0));
}
async function fixture(withSentMessage = false) {
  const client = new MockAgentClient();
  const configured = await client.saveModelConfiguration({ apiKey: "fixture-key", apiFormat: "openai-chat-completions",
    baseUrl: "https://fixture.invalid/v1", providerName: "Paste fixture",
    models: [{ contextWindow: 200_000, displayName: "Paste fixture", modelId: "paste-fixture", reasoningOptions: [] }] });
  const conversation = await client.createConversation({ projectId: null });
  const target = { ...createProjectSession(null, [], conversation.id), modelSelection: {
    providerId: configured.providerId!, modelId: configured.modelId!, reasoning: null } };
  const capabilities = await client.getCapabilities();
  vi.spyOn(client, "getCapabilities").mockResolvedValue({ ...capabilities, mode: "desktop" });
  let drafts: ConversationAttachment[] = [];
  vi.spyOn(client, "listDraftConversationAttachments").mockImplementation(() => Promise.resolve(drafts));
  const importer = vi.spyOn(client, "importConversationAttachmentBytes").mockImplementation(input => {
    const attachment: ConversationAttachment = { id: crypto.randomUUID(), conversationId: target.id,
      name: input.name, mimeType: input.mimeType ?? "text/plain", kind: "file", source: "upload",
      sizeBytes: atob(input.base64).length, contextTokens: 100, truncated: false,
      messageId: null, projectPath: null, createdAt: "2026-10-14T00:00:00.000Z" };
    drafts = [...drafts, attachment];
    return Promise.resolve(drafts);
  });
  const remove = vi.spyOn(client, "removeConversationAttachment").mockImplementation(input => {
    drafts = drafts.filter(attachment => attachment.id !== input.attachmentId);
    return Promise.resolve();
  });
  const sentId = crypto.randomUUID();
  const original: ConversationAttachment = { id: crypto.randomUUID(), conversationId: target.id,
    name: "original.txt", mimeType: "text/plain", kind: "file", source: "upload", sizeBytes: 10,
    contextTokens: 10, truncated: false, messageId: sentId, projectPath: null, createdAt: "2026-10-14T00:00:00.000Z" };
  const sentMessage = { id: sentId, attachments: [original], content: "原消息", conversationId: target.id,
    kind: "message" as const, role: "user" as const, status: "completed" as const, runId: crypto.randomUUID(),
    modelId: configured.modelId, createdAt: "2026-10-14T00:00:00.000Z" };
  if (withSentMessage) vi.spyOn(client, "listConversationTimeline").mockResolvedValue([sentMessage]);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={target} /></TooltipProvider>);
    await flush();
  });
  const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]')!;
  const setText = (value: string): void => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const paste = async (text: string, files: File[] = []): Promise<Event> => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files, items: [], getData: () => text } });
    await act(async () => { textarea.dispatchEvent(event); await flush(); });
    return event;
  };
  return { client, container, importer, paste, remove, setText, target, textarea, sentMessage, getDrafts: () => drafts };
}

it("imports long Unicode paste as one removable TXT while keeping the typed prompt", async () => {
  const view = await fixture();
  view.setText("请分析附件");
  const text = `  中文 😀\r\n${"日志内容\n".repeat(21)}尾部  `;
  const event = await view.paste(text);
  expect(event.defaultPrevented).toBe(true);
  const input = view.importer.mock.calls[0]?.[0];
  expect(input).toMatchObject({ conversationId: view.target.id, mimeType: "text/plain" });
  expect(input?.name).toMatch(/^粘贴文本-\d+\.txt$/);
  expect(new TextDecoder().decode(Uint8Array.from(atob(input!.base64), character => character.charCodeAt(0)))).toBe(text);
  expect(view.textarea.value).toBe("请分析附件");
  expect(view.container.textContent).toContain("TXT");
  expect(view.container.textContent).toContain(input!.name);
  await act(async () => {
    view.container.querySelector<HTMLButtonElement>(`[aria-label="移除附件 ${input!.name}"]`)?.click();
    await flush();
  });
  expect(view.remove).toHaveBeenCalledOnce();
  expect(view.getDrafts()).toHaveLength(0);
  expect(view.container.textContent).not.toContain(input!.name);
});

it("keeps short paste native and gives existing clipboard files priority over long text", async () => {
  const view = await fixture();
  expect((await view.paste("简短文本")).defaultPrevented).toBe(false);
  expect(view.importer).not.toHaveBeenCalled();
  await view.paste("字".repeat(2_001), [new File(["source"], "source.txt", { type: "text/plain" })]);
  expect(view.importer).toHaveBeenCalledExactlyOnceWith({ base64: btoa("source"), conversationId: view.target.id,
    mimeType: "text/plain", name: "source.txt" });
});

it("restores the pasted text and error if attachment storage fails", async () => {
  const view = await fixture();
  view.importer.mockRejectedValueOnce(new Error("磁盘写入失败"));
  view.setText("已有提示");
  const text = "原文\n".repeat(21);
  await view.paste(text);
  expect(view.textarea.value).toBe(`已有提示\n${text}`);
  expect(view.container.textContent).toContain("磁盘写入失败");
  expect(view.getDrafts()).toHaveLength(0);
});

it("waits for TXT import before sending its attachment ID with the prompt", async () => {
  const view = await fixture();
  let finishImport: (() => void) | undefined;
  const actualImport = view.importer.getMockImplementation()!;
  view.importer.mockImplementationOnce(input => new Promise(resolve => {
    finishImport = () => { void actualImport(input).then(resolve); };
  }));
  const send = vi.spyOn(view.client, "sendConversationMessage").mockResolvedValue({ kind: "pending", pendingMessage: {
    id: crypto.randomUUID(), conversationId: view.target.id, content: "请分析附件", attachmentIds: [],
    createdAt: "2026-10-14T00:00:00.000Z", deliveryMode: "queue", referencedConversationIds: [], referencedProjectPaths: [] } });
  view.setText("请分析附件");
  await view.paste("字".repeat(2_001));
  const form = view.container.querySelector<HTMLFormElement>("form.conversation-workspace__composer")!;
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flush(); });
  expect(send).not.toHaveBeenCalled();
  await act(async () => { finishImport?.(); await flush(); });
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flush(); });
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[0]).toMatchObject({ content: "请分析附件", attachmentIds: [view.getDrafts()[0]?.id] });
});

it("retains existing attachments when pasting TXT while editing the latest message", async () => {
  const view = await fixture(true);
  const replace = vi.spyOn(view.client, "replaceLatestConversationMessage").mockResolvedValue({
    runId: crypto.randomUUID(), userMessage: view.sentMessage });
  await act(async () => {
    view.container.querySelector<HTMLButtonElement>('[aria-label="编辑并重新生成"]')?.click();
    await flush();
  });
  await view.paste("字".repeat(2_001));
  expect(view.textarea.value).toBe("原消息");
  expect(view.container.textContent).toContain(view.getDrafts()[0]!.name);
  await act(async () => {
    view.container.querySelector("form.conversation-workspace__composer")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(replace).toHaveBeenCalledOnce();
  expect(replace.mock.calls[0]?.[0]).toMatchObject({ messageId: view.sentMessage.id, content: "原消息",
    attachmentIds: [view.sentMessage.attachments[0]!.id, view.getDrafts()[0]!.id] });
});

it("leaves long text available for native paste when the ten-attachment limit is reached", async () => {
  const view = await fixture();
  for (let index = 0; index < 10; index += 1) {
    await view.paste("", [new File(["file"], `file-${index}.txt`, { type: "text/plain" })]);
  }
  expect((await view.paste("字".repeat(2_001))).defaultPrevented).toBe(false);
  expect(view.importer).toHaveBeenCalledTimes(10);
  expect(view.container.textContent).toContain("每条消息最多添加 10 个附件");
});
