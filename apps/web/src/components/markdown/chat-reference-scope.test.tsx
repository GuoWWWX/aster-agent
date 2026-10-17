// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ChatReference } from "@agent/protocol";
import { AgentMarkdown } from "./agent-markdown.js";
import { ChatReferenceScope, proseReferenceIds } from "./chat-reference-scope.js";

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
