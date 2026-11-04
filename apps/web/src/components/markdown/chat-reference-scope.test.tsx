// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ChatReference } from "@agent/protocol";
import { AgentMarkdown } from "./agent-markdown.js";
import { ChatReferenceScope, proseReferenceIds } from "./chat-reference-scope.js";
import { UserMessageContent } from "../../features/chat/user-message-content.js";

it("turns legacy inline-code message IDs and task IDs into source quotes and named task links", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const messageId = crypto.randomUUID(); const taskId = crypto.randomUUID(); const containerId = crypto.randomUUID();
  const references: ChatReference[] = [
    { kind: "message", id: messageId, sourceKind: "group", containerId, senderName: "后端开发", content: "这是已经公开的完整源码", createdAt: new Date().toISOString() },
    { kind: "task", id: taskId, title: "验收消息引用", ownerConversationId: containerId, teamInstanceId: containerId },
  ];
  const resolve = vi.fn().mockResolvedValue(references); const open = vi.fn();
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  try {
    await act(async () => { root.render(<ChatReferenceScope scopeKey={containerId} resolve={resolve} onOpen={open}><AgentMarkdown content={`完整源码已在群消息 \`${messageId}\` 中公开，关联任务${taskId}；另见 [任务 验收消息引用](task://${taskId})。`} /></ChatReferenceScope>); for (let i = 0; i < 8; i++) await Promise.resolve(); });
    expect(element.textContent).not.toContain(messageId); expect(element.textContent).not.toContain(taskId);
    expect(element.querySelector('a[href^="task:"]')).toBeNull();
    expect(element.textContent).toContain("后端开发"); expect(element.textContent).toContain("这是已经公开的完整源码");
    act(() => element.querySelector<HTMLButtonElement>('[aria-label="打开任务 验收消息引用"]')!.click());
    expect(open).toHaveBeenLastCalledWith(references[1]);
    act(() => element.querySelector<HTMLButtonElement>('[aria-label="定位 后端开发 的引用消息"]')!.click());
    expect(open).toHaveBeenLastCalledWith(references[0]);
  } finally { act(() => root.unmount()); element.remove(); }
});
it("does not resolve code fences and preserves UUID programming examples", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const id = crypto.randomUUID();
  expect(proseReferenceIds(`~~~json\n{"id":"${id}"}\n~~~`)).toEqual([]);
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  const resolve = vi.fn().mockResolvedValue([]);
  try {
    await act(async () => { root.render(<ChatReferenceScope scopeKey="example" resolve={resolve} onOpen={() => {}}><AgentMarkdown content={`示例 UUID：\`${id}\``} /></ChatReferenceScope>); await Promise.resolve(); });
    expect(element.querySelector("code")?.textContent).toBe(id);
    expect(element.querySelector("button")).toBeNull();
  } finally { act(() => root.unmount()); element.remove(); }
});
it("hides unavailable contextual references without inventing a clickable target", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); const id = crypto.randomUUID();
  const element = document.createElement("div"); const root = createRoot(element);
  try {
    await act(async () => { root.render(<ChatReferenceScope scopeKey="missing" resolve={() => Promise.resolve([])} onOpen={() => {}}><AgentMarkdown content={`群消息 \`${id}\``} /></ChatReferenceScope>); for (let i = 0; i < 8; i++) await Promise.resolve(); });
    expect(element.textContent).not.toContain(id); expect(element.textContent).toContain("引用已不可用"); expect(element.querySelector("button")).toBeNull();
  } finally { act(() => root.unmount()); }
});

it("renders user task and message references as inline mentions alongside selected members", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const taskId = crypto.randomUUID(); const messageId = crypto.randomUUID(); const containerId = crypto.randomUUID();
  const references: ChatReference[] = [
    { kind: "task", id: taskId, title: "HTML 交付验收", ownerConversationId: containerId, teamInstanceId: containerId },
    { kind: "message", id: messageId, sourceKind: "group", containerId, senderName: "前端开发", content: "原成果已完成", createdAt: new Date().toISOString() },
  ];
  const resolve = vi.fn().mockResolvedValue(references); const open = vi.fn();
  const content = `沿用任务 ${taskId}，成果消息 \`${messageId}\`；另见 [任务](task://${taskId})。 @前端开发 请核对`;
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  try {
    await act(async () => {
      root.render(<ChatReferenceScope scopeKey={containerId} resolve={resolve} onOpen={open}>
        <UserMessageContent content={content} inlineReferences={[{ label: "@前端开发", content: <button>＠前端开发</button> }]} />
      </ChatReferenceScope>);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(element.textContent).toContain("@HTML 交付验收");
    expect(element.textContent).toContain("@前端开发的消息");
    expect(element.textContent).toContain("＠前端开发");
    expect(element.textContent).not.toContain(taskId); expect(element.textContent).not.toContain(messageId);
    expect(element.textContent).not.toContain("task://");
    expect(element.querySelector('[data-message-reference-quote]')).toBeNull();
    act(() => element.querySelector<HTMLButtonElement>('[aria-label="定位 前端开发 的引用消息"]')!.click());
    expect(open).toHaveBeenLastCalledWith(references[1]);
    act(() => element.querySelector<HTMLButtonElement>('[aria-label="打开任务 HTML 交付验收"]')!.click());
    expect(open).toHaveBeenLastCalledWith(references[0]);
    expect(resolve).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); element.remove(); }
});

it("shows an attributed three-line quote with a plain preview and one source target", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const messageId = crypto.randomUUID(); const containerId = crypto.randomUUID();
  const reference: ChatReference = { kind: "message", id: messageId, sourceKind: "group", containerId,
    senderName: "前端开发", content: "已完成 [页面](deliverable.html)。\n**按钮**通过。\n第三行。\n第四行。", createdAt: new Date().toISOString() };
  const open = vi.fn(); const avatar = vi.fn(() => <img alt="前端开发头像" src="/avatar.png" />);
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  try {
    await act(async () => {
      root.render(<ChatReferenceScope scopeKey={containerId} resolve={() => Promise.resolve([reference])} onOpen={open} renderMessageAvatar={avatar}>
        <AgentMarkdown content={`原成果见消息 ${messageId}`} />
      </ChatReferenceScope>);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    const quote = element.querySelector<HTMLButtonElement>('[data-message-reference-quote]')!;
    expect(quote).not.toBeNull(); expect(quote.querySelector('img[alt="前端开发头像"]')).not.toBeNull();
    expect(quote.textContent).toContain("前端开发");
    expect(quote.textContent).toContain("已完成 页面。");
    expect(quote.textContent).not.toContain("[页面]"); expect(quote.textContent).not.toContain("**");
    expect(quote.querySelector('[data-message-reference-preview]')?.classList.contains("line-clamp-3")).toBe(true);
    expect(quote.querySelector("a")).toBeNull();
    act(() => quote.click()); expect(open).toHaveBeenLastCalledWith(reference);
    expect(avatar).toHaveBeenCalledWith(reference);
  } finally { act(() => root.unmount()); element.remove(); }
});

it("preserves user code fences, external links and non-reference inline code", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const id = crypto.randomUUID(); const containerId = crypto.randomUUID();
  const reference: ChatReference = { kind: "message", id, sourceKind: "group", containerId, senderName: "测试工程师", content: "通过", createdAt: new Date().toISOString() };
  const content = `消息 ${id}\n\`\`\`json\n{"messageId":"${id}"}\n\`\`\`\nhttps://example.test/${id}\n\`const id = '${id}'\``;
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  try {
    await act(async () => {
      root.render(<ChatReferenceScope scopeKey={containerId} resolve={() => Promise.resolve([reference])} onOpen={() => {}}><UserMessageContent content={content} /></ChatReferenceScope>);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(element.querySelectorAll('[aria-label="定位 测试工程师 的引用消息"]')).toHaveLength(1);
    expect(element.textContent).toContain(`{"messageId":"${id}"}`);
    expect(element.textContent).toContain(`https://example.test/${id}`);
    expect(element.textContent).toContain(`const id = '${id}'`);
  } finally { act(() => root.unmount()); element.remove(); }
});

it("updates avatars and click handlers without reloading resolved references", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const id = crypto.randomUUID(); const containerId = crypto.randomUUID();
  const reference: ChatReference = { kind: "message", id, sourceKind: "group", containerId,
    senderName: "前端开发", content: "已完成", createdAt: new Date().toISOString() };
  const resolve = vi.fn().mockResolvedValue([reference]); const firstOpen = vi.fn(); const nextOpen = vi.fn();
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  const show = async (image: string, onOpen: typeof firstOpen) => {
    await act(async () => {
      root.render(<ChatReferenceScope scopeKey={containerId} resolve={resolve} onOpen={onOpen}
        renderMessageAvatar={() => <img alt="成员头像" src={image} />}><AgentMarkdown content={`群消息 ${id}`} /></ChatReferenceScope>);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  };
  try {
    await show("/first.png", firstOpen); await show("/updated.png", nextOpen);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(element.querySelector('img[alt="成员头像"]')?.getAttribute("src")).toBe("/updated.png");
    act(() => element.querySelector<HTMLButtonElement>('[data-message-reference-quote]')!.click());
    expect(nextOpen).toHaveBeenCalledWith(reference); expect(firstOpen).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); element.remove(); }
});
