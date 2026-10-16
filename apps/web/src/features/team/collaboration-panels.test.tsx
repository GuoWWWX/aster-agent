// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TaskContextDirectory } from "./task-context-directory.js";
import { TeamChatPanel } from "./team-chat-panel.js";
import { TeamChatWorkspace } from "./team-chat-workspace.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";

let root: Root | null = null;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = () => { const element = document.createElement("div"); document.body.append(element); root = createRoot(element); return element; };
function input(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set?.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true }));
}
it("shows one task with sources and opens the original message", async () => {
  const client = new MockAgentClient(); const conversation = await client.createConversation({});
  const task = await client.updateTaskContext({ conversationId: conversation.id, title: "排查遮挡", goal: "弹框可点击", requestId: crypto.randomUUID() });
  const messageId = crypto.randomUUID(); await client.linkTaskContext({ id: task.id, source: { kind: "conversation", containerId: conversation.id, messageId, purpose: "verification" } });
  const open = vi.fn(); const container = mount();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TaskContextDirectory agentClient={client} conversationId={conversation.id} onOpenConversation={open} /></TooltipProvider>); }));
  expect(container.textContent).toContain("排查遮挡"); expect(container.textContent).toContain("进行中");
  const expand = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("排查遮挡"));
  await act(() => Promise.resolve().then(() => { expand?.click(); }));
  const source = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("verification"));
  await act(() => Promise.resolve().then(() => { source?.click(); }));
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: conversation.id }), messageId);
  expect(container.querySelectorAll("ul > li").length).toBeGreaterThan(1);
});
it("reuses the ordinary composer and sends its selected member references as group recipients", async () => {
  const client = new MockAgentClient(); const { instance, sessions } = await groupFixture(client);
  const roster = await client.getTeamChatMembers({ teamInstanceId: instance.id }); const selectedMembers = roster.filter(item => !item.isLead).slice(0, 2);
  const post = vi.spyOn(client, "postTeamChat"); const container = mount();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatWorkspace agentClient={client} instance={instance} sessions={sessions} projects={[]} onSessionUpdated={() => undefined} active onOpenConversation={() => undefined} /></TooltipProvider>); }));
  const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]')!;
  expect(textarea).not.toBeNull();
  for (const label of ["群消息用途", "关联任务", "要求全员回答"]) expect(container.querySelector(`[aria-label="${label}"]`)).toBeNull();
  expect(container.querySelector('[aria-label="权限模式"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="模型"]')).not.toBeNull();
  expect(selectedMembers).toHaveLength(2);
  for (const member of selectedMembers) {
    await act(() => Promise.resolve().then(() => { input(textarea, textarea.value + "@"); }));
    const option = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.textContent?.includes(member.name));
    expect(option).toBeDefined();
    await act(() => Promise.resolve().then(() => { option?.click(); }));
  }
  await act(() => Promise.resolve().then(() => { input(textarea, textarea.value + "请核实接口"); }));
  await act(() => Promise.resolve().then(() => { container.querySelector<HTMLButtonElement>('[aria-label="发送任务"]')?.click(); }));
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ recipientConversationIds: selectedMembers.map(member => member.conversationId), intent: "request" }));
  expect(post.mock.calls[0]?.[0].content).toContain("请核实接口");
  expect(container.querySelectorAll('[data-group-message]')).toHaveLength(1);
});
async function groupFixture(client: MockAgentClient) {
  await client.saveModelConfiguration({ apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://fixture.invalid/v1", providerName: "fixture",
    models: [{ contextWindow: 200000, displayName: "fixture", modelId: "fixture", reasoningOptions: [] }] });
  const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  const sessions = (await client.listConversationHierarchy()).map(conversation => ({ ...conversation, pinOrder: conversation.pinOrder ?? null }));
  return { instance, sessions };
}

it("mentions only current group members with their profile avatars, names and roles", async () => {
  const client = new MockAgentClient(); const { instance, sessions } = await groupFixture(client);
  const roster = await client.getTeamChatMembers({ teamInstanceId: instance.id });
  const member = roster.find(item => !item.isLead)!;
  const conversation = sessions.find(item => item.id === member.conversationId)!;
  const profile = useAgentDirectoryStore.getState().agents.find(agent => agent.id === conversation.agentId)!;
  const avatar = profile.avatar;
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
  useAgentDirectoryStore.getState().updateAgent(profile.id, { avatar: { kind: "image", dataUrl: image, fileName: "avatar.png" } });
  try {
    const members = roster.map((item, index) => ({ ...item, name: item.conversationId === member.conversationId ? "测试工程师" : `成员${index}`, role: "团队职责" }));
    const archived = { ...members.at(-1)!, isArchived: true };
    vi.spyOn(client, "getTeamChatMembers").mockResolvedValue([...members.slice(0, -1), archived]);
    const post = vi.spyOn(client, "postTeamChat");
    const unrelated = { ...conversation, id: crypto.randomUUID(), title: "临时聊天干扰项" };
    const container = mount();
    await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatWorkspace agentClient={client} instance={instance} sessions={[...sessions, unrelated]} projects={[]} onSessionUpdated={() => undefined} active onOpenConversation={() => undefined} /></TooltipProvider>); }));
    const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]')!;
    await act(() => Promise.resolve().then(() => { input(textarea, "@"); }));
    const menu = container.querySelector('[role="listbox"][aria-label="选择群成员"]')!;
    expect(menu).not.toBeNull();
    expect(menu.querySelector('[role="presentation"]')?.textContent).toBe("群成员");
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(members.length - 1);
    expect(menu.textContent).not.toContain("临时对话");
    expect(menu.textContent).not.toContain(conversation.title);
    expect(menu.textContent).not.toContain(unrelated.title);
    expect(menu.textContent).not.toContain(archived.name);
    const option = [...menu.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.querySelector("strong")?.textContent === "测试工程师")!;
    expect(option.querySelector('[data-member-avatar] img')?.getAttribute("src")).toBe(image);
    expect(option.querySelector("small")?.textContent).toBe("团队职责");
    await act(() => Promise.resolve().then(() => { input(textarea, "@测试"); }));
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(1);
    await act(() => Promise.resolve().then(() => { textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }));
    expect(textarea.value.trim()).toBe("测试工程师");
    expect(container.querySelector('[data-composer-reference-icon] img')?.getAttribute("src")).toBe(image);
    await act(() => Promise.resolve().then(() => { input(textarea, textarea.value + "请确认"); }));
    await act(() => Promise.resolve().then(() => { container.querySelector<HTMLButtonElement>('[aria-label="发送任务"]')?.click(); }));
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ content: "@测试工程师 请确认", recipientConversationIds: [member.conversationId] }));
  } finally { useAgentDirectoryStore.getState().updateAgent(profile.id, { avatar }); }
});

it("uses the conversation bubbles with the user's message on the right and a member's icon and name above the left bubble", async () => {
  const client = new MockAgentClient();
  const { instance, sessions } = await groupFixture(client);
  const member = (await client.getTeamChatMembers({ teamInstanceId: instance.id })).find(item => !item.isLead)!;
  const request = await client.postTeamChat({ teamInstanceId: instance.id, content: "请核对", requestId: crypto.randomUUID() });
  vi.spyOn(client, "readTeamChat").mockResolvedValue({ messages: [request, { ...request, id: crypto.randomUUID(), sequence: 2,
    content: "核对完成", senderConversationId: member.conversationId, senderName: member.name, deliveries: [], intent: "notify" }],
    nextBeforeSequence: null, userReadSequence: 0, memberReadSequence: 0 });
  const container = mount();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatWorkspace agentClient={client} instance={instance} sessions={sessions} projects={[]} onSessionUpdated={() => undefined} active onOpenConversation={() => undefined} /></TooltipProvider>); }));
  expect(container.querySelector('.chat-message-group[data-role="user"] .chat-message[data-role="user"]')?.textContent).toBe("请核对");
  const response = container.querySelector('.chat-message-group[data-role="assistant"]')!;
  const identity = response.querySelector('[data-group-sender]')!;
  expect(identity.textContent).toBe(member.name);
  expect(identity.querySelector(`[aria-label="${member.name}图标"] svg`)).not.toBeNull();
  expect(identity.nextElementSibling?.classList.contains("chat-message--enclosed")).toBe(true);
  expect(response.querySelector('.chat-message[data-role="assistant"]')?.textContent?.trim()).toBe("核对完成");
  expect(container.querySelector('.conversation-workspace__composer-surface')).not.toBeNull();
});

it("does not mark messages read while a retained group tab is hidden", async () => {
  const client = new MockAgentClient(); const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  await client.postTeamChat({ teamInstanceId: instance.id, content: "notification", intent: "notify", requestId: crypto.randomUUID() });
  const mark = vi.spyOn(client, "markTeamChatRead"); const container = mount();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatPanel agentClient={client} teamInstanceId={instance.id} active={false} onOpenConversation={() => undefined} /></TooltipProvider>); }));
  expect(container.querySelector('[data-group-message]')).not.toBeNull(); expect(mark).not.toHaveBeenCalled();
});

it("renders selected group mentions as member avatars and blue names that open their own conversations", async () => {
  const client = new MockAgentClient(); const { instance, sessions } = await groupFixture(client);
  const roster = await client.getTeamChatMembers({ teamInstanceId: instance.id });
  const member = roster.find(item => !item.isLead)!;
  const conversation = sessions.find(item => item.id === member.conversationId)!;
  // Real team bindings use the short Agent name, while older composer messages contain the full conversation title.
  const name = "测试工程师";
  vi.spyOn(client, "getTeamChatMembers").mockResolvedValue(roster.map(item => item.conversationId === member.conversationId ? { ...item, name } : item));
  await client.postTeamChat({ teamInstanceId: instance.id, content: `@${conversation.title} 请核实， @${name} 谢谢。@其他成员 保留原文。`,
    recipientConversationIds: [member.conversationId], requestId: crypto.randomUUID() });
  const open = vi.fn(); const container = mount();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatPanel agentClient={client} teamInstanceId={instance.id} onOpenConversation={open} /></TooltipProvider>); }));
  const bubble = container.querySelector('.chat-message[data-role="user"]')!;
  const mentions = bubble.querySelectorAll<HTMLButtonElement>(`button[aria-label="打开成员 ${name} 的对话"]`);
  expect(mentions).toHaveLength(2);
  expect(mentions[0]?.textContent).toBe(name);
  expect(mentions[0]?.querySelector("svg")).not.toBeNull();
  expect(mentions[0]?.classList.contains("text-[var(--app-accent)]")).toBe(true);
  expect(bubble.textContent).not.toContain(conversation.title);
  expect(bubble.textContent).toContain("@其他成员 保留原文。");
  await act(() => Promise.resolve().then(() => { mentions[0]?.click(); }));
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: member.conversationId }));
});
