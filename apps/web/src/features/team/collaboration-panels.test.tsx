// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationRunEvent } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TaskContextDirectory } from "./task-context-directory.js";
import { TeamChatPanel } from "./team-chat-panel.js";
import { TeamChatWorkspace } from "./team-chat-workspace.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { ConversationWorkspace, WorkspaceContent } from "../chat/workspace-content.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";

let root: Root | null = null;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = () => { const element = document.createElement("div"); document.body.append(element); root = createRoot(element); return element; };

it("follows a loaded preview at the bottom and preserves a reader's older position", async () => {
  let resize = () => {}; const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(private readonly callback: () => void) {}
    observe(element: Element) { if (element.hasAttribute("data-group-message-list")) resize = this.callback; }
    disconnect() { disconnect(); }
  });
  const client = new MockAgentClient(); const { instance } = await groupFixture(client); const container = mount();
  const show = async (active: boolean) => { await act(async () => { root?.render(<TooltipProvider><TeamChatPanel agentClient={client} teamInstanceId={instance.id}
    active={active} onOpenConversation={() => undefined} /></TooltipProvider>); await Promise.resolve(); }); };
  await show(true); const viewport = container.querySelector<HTMLElement>('[aria-label="群消息"]')!;
  Object.defineProperties(viewport, { clientHeight: { configurable: true, value: 600 }, scrollHeight: { configurable: true, value: 2000 } });
  act(() => resize()); expect(viewport.scrollTop).toBe(2000);
  act(() => { viewport.scrollTop = 100; viewport.dispatchEvent(new Event("scroll")); resize(); });
  expect(viewport.scrollTop).toBe(100);
  await show(false); expect(disconnect).toHaveBeenCalled();
});

it("retains the group pane, draft and reading position when a preview tab is replaced", async () => {
  const client = new MockAgentClient(); const { instance, sessions } = await groupFixture(client);
  await client.postTeamChat({ teamInstanceId: instance.id, content: "cached group", intent: "notify", requestId: crypto.randomUUID() });
  const read = vi.spyOn(client, "readTeamChat"); const container = mount();
  const show = async (group: boolean) => { await act(async () => {
    useWorkbenchUiStore.setState({ activeActivity: "conversations", teamChatTarget: group ? { instanceId: instance.id } : null });
    root?.render(<TooltipProvider><WorkspaceContent agentClient={client} activeProject={null} activeSession={sessions[0]!}
      projects={[]} sessions={sessions} teamInstances={[instance]} openTeamChatInstanceIds={group ? [instance.id] : []}
      canAddProjects={false} isAddingProject={false} isCreatingSession={false}
      onAddProject={() => Promise.resolve(null)} onCreateProjectSession={() => undefined} onCreateTemporarySession={() => undefined}
      onForkConversation={() => Promise.resolve(undefined)} onLocateProject={() => undefined} onLocateSession={() => undefined}
      onOpenTeamConversation={() => undefined} onProjectSelected={() => undefined} onSessionSelected={() => undefined}
      onSessionUpdated={() => undefined} onSessionViewed={() => undefined} /></TooltipProvider>);
    for (let i = 0; i < 15; i++) await Promise.resolve();
  }); };
  try {
    await show(true);
    const viewport = container.querySelector<HTMLElement>('[aria-label="群消息"]')!;
    Object.defineProperties(viewport, { clientHeight: { configurable: true, value: 600 }, scrollHeight: { configurable: true, value: 2000 } });
    const composer = container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]')!;
    act(() => { input(composer, "尚未发送的群聊草稿"); viewport.scrollTop = 75; viewport.dispatchEvent(new Event("scroll")); });
    const reads = read.mock.calls.length;
    await show(false);
    expect(viewport.isConnected).toBe(true);
    await show(true);
    expect(container.querySelector('[aria-label="群消息"]')).toBe(viewport);
    expect(viewport.scrollTop).toBe(75);
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]')?.value).toBe("尚未发送的群聊草稿");
    expect(read).toHaveBeenCalledTimes(reads);
  } finally { useWorkbenchUiStore.setState({ teamChatTarget: null }); }
});

it("does not load the leader private queue or task list to open a group composer", async () => {
  const client = new MockAgentClient(); const { instance, sessions } = await groupFixture(client);
  const pending = vi.spyOn(client, "getConversationPendingQueuePaused");
  const tasks = vi.spyOn(client, "getConversationTaskList");
  mount();
  await act(async () => {
    root?.render(<TooltipProvider><TeamChatWorkspace agentClient={client} instance={instance} sessions={sessions} projects={[]}
      onSessionUpdated={() => undefined} active onOpenConversation={() => undefined} /></TooltipProvider>);
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
  expect(pending).not.toHaveBeenCalled(); expect(tasks).not.toHaveBeenCalled();
});
it("opens group coordination from its centered large avatar and original message without changing the composer", async () => {
  const client = new MockAgentClient(); const { instance, sessions } = await groupFixture(client);
  const recipient = (await client.getTeamChatMembers({ teamInstanceId: instance.id })).find(member => !member.isLead)!;
  const message = await client.postTeamChat({ teamInstanceId: instance.id, content: "查看这条协调", requestId: crypto.randomUUID(),
    recipientConversationIds: [recipient.conversationId], coordinator: { agentId: "default-agent", modelSelection: null } });
  const container = mount();
  await act(async () => { root?.render(<TooltipProvider><TeamChatWorkspace agentClient={client} instance={instance} sessions={sessions}
    projects={[]} onSessionUpdated={() => undefined} active onOpenConversation={() => undefined} /></TooltipProvider>); await Promise.resolve(); });
  const composer = container.querySelector('[aria-label="输入任务"]');
  const coordinator = container.querySelector('[aria-label="群聊协调 Agent"]')!;
  expect(coordinator.closest('.conversation-workspace__surface')).not.toBeNull();
  expect(coordinator.querySelector('[data-size="large"]')).not.toBeNull();
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="查看后台协调"]')!.click(); await Promise.resolve(); });
  expect(useWorkbenchUiStore.getState().teamChatCoordinationTarget).toMatchObject({ instanceId: instance.id });
  const messageAction = container.querySelector<HTMLButtonElement>('[aria-label="查看协调过程"]')!;
  expect(messageAction.closest(".chat-message__meta")).not.toBeNull();
  await act(async () => { messageAction.click(); await Promise.resolve(); });
  expect(useWorkbenchUiStore.getState().teamChatCoordinationTarget).toMatchObject({ instanceId: instance.id, messageId: message.id, sequence: message.sequence });
  expect(container.querySelector('[aria-label="输入任务"]')).toBe(composer);
  const results = container.querySelector<HTMLButtonElement>('[aria-label="查看协调结果"]')!;
  expect(results.closest('.conversation-workspace__header')).not.toBeNull();
  await act(async () => { results.click(); for (let i = 0; i < 15; i++) await Promise.resolve(); });
  expect(document.querySelector('[aria-label="协调结果"]')?.textContent).toContain(message.content);
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="查看这条消息的完整协调对话"]')!.click(); await Promise.resolve(); });
  expect(useWorkbenchUiStore.getState().teamChatCoordinationTarget).toMatchObject({ instanceId: instance.id, messageId: message.id, sequence: message.sequence });
  expect(container.querySelector('[aria-label="输入任务"]')).toBe(composer);
});
function input(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set?.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true }));
}
it("shows one task with sources and opens the original message", async () => {
  const client = new MockAgentClient(); const conversation = await client.createConversation({});
  await client.updateTaskContext({ conversationId: conversation.id, title: "排查遮挡", goal: "弹框可点击", requestId: crypto.randomUUID() });
  const messageId = crypto.randomUUID();
  const sources: Awaited<ReturnType<typeof client.getTaskContext>>["sources"] = [{ kind: "conversation", containerId: conversation.id, messageId, runId: null, purpose: "verification", available: true, title: conversation.title, sequence: 1, role: "user", content: "检查原始需求消息", createdAt: new Date().toISOString() }];
  const get = client.getTaskContext.bind(client);
  vi.spyOn(client, "getTaskContext").mockImplementation(async input => ({ ...await get(input), sources }));
  const open = vi.fn(); const container = mount();
  await act(async () => { root?.render(<TooltipProvider><TaskContextDirectory agentClient={client} conversationId={conversation.id} onOpenConversation={open} /></TooltipProvider>); for (let i = 0; i < 10; i++) await Promise.resolve(); });
  expect(container.textContent).toContain("排查遮挡"); expect(container.textContent).toContain("进行中");
  expect(container.textContent).toContain("检查原始需求消息");
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="任务详情"] button')?.click();
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("定位原消息"))?.click(); await Promise.resolve(); });
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: conversation.id }), messageId);
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

it("opens and previews a leader's delivered file in the original implementer's workspace", async () => {
  const client = new MockAgentClient(); const { instance } = await groupFixture(client);
  const members = await client.getTeamChatMembers({ teamInstanceId: instance.id }); const author = members.find(member => !member.isLead)!; const lead = members.find(member => member.isLead)!;
  const source = await client.postTeamChat({ teamInstanceId: instance.id, content: "实现已完成", intent: "notify", requestId: crypto.randomUUID() });
  const final = await client.postTeamChat({ teamInstanceId: instance.id, content: "验收通过：[页面](out/card.html)", intent: "notify", requestId: crypto.randomUUID() });
  const read = client.readTeamChat.bind(client);
  vi.spyOn(client, "readTeamChat").mockImplementation(async input => { const page = await read(input); return { ...page, messages: page.messages.map(message => message.id === final.id
    ? { ...message, senderConversationId: lead.conversationId, senderName: lead.name, fileReferences: [{ sourceMessageId: source.id, conversationId: author.conversationId, path: "out/card.html" }] } : message) }; });
  const preview = vi.spyOn(client, "htmlPreview").mockResolvedValue(null); const open = vi.fn(); const container = mount();
  await act(async () => { root?.render(<TooltipProvider><TeamChatPanel agentClient={client} teamInstanceId={instance.id} onOpenConversation={() => undefined} onOpenFile={open} /></TooltipProvider>); for (let i = 0; i < 15; i++) await Promise.resolve(); });
  expect(preview).not.toHaveBeenCalled(); expect(container.textContent).toContain(`成果来源：${author.name}`);
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="打开原始成果 out/card.html"]')!.click());
  expect(open).toHaveBeenCalledWith(author.conversationId, "out/card.html");
  act(() => { container.querySelector<HTMLAnchorElement>('a[href="out/card.html"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  expect(open).toHaveBeenLastCalledWith(author.conversationId, "out/card.html");
  await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "预览页面")!.click(); await Promise.resolve(); });
  expect(preview).toHaveBeenCalledWith({ kind: "file", conversationId: author.conversationId, path: "out/card.html" });
});

it.each([0, 5])("selects all current group members even after %s individual mentions and renders the effective mention", async count => {
  const client = new MockAgentClient(); const { instance, sessions } = await groupFixture(client);
  const post = vi.spyOn(client, "postTeamChat"); const container = mount();
  await act(async () => { root?.render(<TooltipProvider><TeamChatWorkspace agentClient={client} instance={instance} sessions={sessions} projects={[]}
    active onSessionUpdated={() => undefined} onOpenConversation={() => undefined} /></TooltipProvider>); for (let i = 0; i < 15; i++) await Promise.resolve(); });
  const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]')!;
  for (let i = 0; i < count; i++) {
    await act(async () => { input(textarea, textarea.value + "@"); await Promise.resolve(); });
    act(() => container.querySelector<HTMLButtonElement>('[role="option"][data-group-member]')!.click());
  }
  await act(async () => { input(textarea, textarea.value + "@"); await Promise.resolve(); });
  const option = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.querySelector("strong")?.textContent === "全体成员")!;
  expect(option).toBeDefined(); act(() => option.click());
  expect(textarea.value).toContain("全体成员"); act(() => input(textarea, textarea.value + "请各自确认"));
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="发送任务"]')!.click(); for (let i = 0; i < 15; i++) await Promise.resolve(); });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ allMembers: true }));
  expect(post.mock.calls[0]![0].recipientConversationIds).toHaveLength(count);
  const message = (await client.readTeamChat({ teamInstanceId: instance.id })).messages[0]!;
  expect(message.recipientConversationIds).toHaveLength((await client.getTeamChatMembers({ teamInstanceId: instance.id })).filter(member => !member.isArchived).length);
  const mention = [...container.querySelectorAll<HTMLButtonElement>('[data-group-message] button')].find(button => button.textContent === "全体成员")!;
  expect(mention.className).toContain("--app-accent"); act(() => mention.click());
  expect(useWorkbenchUiStore.getState().teamChatDetailsTarget?.instanceId).toBe(instance.id);
});

it.each([false, true])("replies to the quoted member without requiring another mention and optionally invites a peer (extra=%s)", async extra => {
  const client = new MockAgentClient(); const { instance, sessions } = await groupFixture(client);
  const members = (await client.getTeamChatMembers({ teamInstanceId: instance.id })).filter(member => !member.isLead);
  const source = await client.postTeamChat({ teamInstanceId: instance.id, content: "成员原始说明", intent: "notify", requestId: crypto.randomUUID() });
  const readOriginal = client.readTeamChat.bind(client);
  vi.spyOn(client, "readTeamChat").mockImplementation(async value => {
    const page = await readOriginal(value);
    return { ...page, messages: page.messages.map(message => message.id === source.id
      ? { ...message, senderConversationId: members[0]!.conversationId, senderName: members[0]!.name } : message) };
  });
  const post = vi.spyOn(client, "postTeamChat");
  const container = mount();
  await act(async () => { root?.render(<TooltipProvider><TeamChatWorkspace agentClient={client} instance={instance} sessions={sessions} projects={[]}
    active onSessionUpdated={() => undefined} onOpenConversation={() => undefined} /></TooltipProvider>); for (let i = 0; i < 15; i++) await Promise.resolve(); });
  const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]')!;
  act(() => container.querySelector<HTMLButtonElement>(`[aria-label="回复 ${members[0]!.name} 的消息"]`)!.click());
  expect(container.textContent).toContain(`回复 ${members[0]!.name}：成员原始说明`);
  if (extra) {
    await act(async () => { input(textarea, "@"); await Promise.resolve(); });
    const option = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.textContent?.includes(members[1]!.name))!;
    act(() => option.click());
  }
  act(() => input(textarea, `${textarea.value} 请进一步确认`));
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="发送任务"]')!.click(); for (let i = 0; i < 15; i++) await Promise.resolve(); });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ replyToId: source.id }));
  expect(post.mock.calls[0]![0].recipientConversationIds).toEqual(extra ? [members[1]!.conversationId] : []);
  expect(container.querySelector('[aria-label="取消引用回复"]')).toBeNull();
});

it("keeps the group send button available while the leader works in its own conversation", async () => {
  const client = new MockAgentClient(); const { instance, sessions } = await groupFixture(client);
  const working = sessions.map(session => session.id === instance.rootConversationId ? { ...session, activeRunId: crypto.randomUUID() } : session);
  const post = vi.spyOn(client, "postTeamChat"); const container = mount();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatWorkspace agentClient={client} instance={instance}
    sessions={working} projects={[]} onSessionUpdated={() => undefined} active onOpenConversation={() => undefined} /></TooltipProvider>); }));
  expect(container.querySelector('[aria-label="停止任务"]')).toBeNull();
  const composer = container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]')!;
  await act(() => Promise.resolve().then(() => { input(composer, "另外一个问题"); }));
  await act(() => Promise.resolve().then(() => { container.querySelector<HTMLButtonElement>('[aria-label="发送任务"]')!.click(); }));
  expect(post.mock.calls[0]?.[0].content).toBe("另外一个问题");
});

it("keeps task context and user questions distinct when reusing the ordinary conversation composer", async () => {
  const client = new MockAgentClient(); const { instance, sessions } = await groupFixture(client);
  const session = sessions.find(item => item.id === instance.rootConversationId)!;
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  mount();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} session={session} project={null} projects={[]} active onSessionUpdated={() => undefined} /></TooltipProvider>); }));
  expect(errors.mock.calls.filter(call => String(call[0]).includes("Encountered two children with the same key"))).toEqual([]);
});

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
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(members.length);
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
  const user = container.querySelector('.chat-message-group[data-role="user"]')!;
  expect(user.querySelector('.chat-message__meta time')).not.toBeNull();
  expect(user.querySelector('[aria-label="复制消息"]')).not.toBeNull();
  expect(user.querySelector('[aria-label="编辑并重新生成"]')).not.toBeNull();
  expect(response.querySelector('.chat-message__meta [aria-label="复制完整回复"]')).not.toBeNull();
  expect(response.querySelector('[aria-label="编辑并重新生成"]')).toBeNull();
  expect(response.querySelector('.chat-message__meta time')).not.toBeNull();
});

it("edits the latest group message in the ordinary composer and sends a linked revision with its owning Agent", async () => {
  const client = new MockAgentClient(); const { instance, sessions } = await groupFixture(client);
  const original = await client.postTeamChat({ teamInstanceId: instance.id, content: "旧问题", intent: "notify", requestId: crypto.randomUUID(),
    coordinator: { agentId: "default-agent", modelSelection: null } });
  const post = vi.spyOn(client, "postTeamChat"); const container = mount();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatWorkspace agentClient={client} instance={instance} sessions={sessions} projects={[]}
    onSessionUpdated={() => undefined} active onOpenConversation={() => undefined} /></TooltipProvider>); }));
  expect(container.querySelector('[aria-label="对话 Agent"]')?.textContent).toContain("默认 Agent");
  await act(() => Promise.resolve().then(() => { container.querySelector<HTMLButtonElement>('[aria-label="编辑并重新生成"]')!.click(); }));
  const composer = container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]')!;
  expect(composer.value).toBe("旧问题");
  await act(() => Promise.resolve().then(() => { input(composer, "修改后的问题"); }));
  await act(() => Promise.resolve().then(() => { container.querySelector<HTMLButtonElement>('[aria-label="保存并重新生成"]')!.click(); }));
  expect(post.mock.calls[0]?.[0]).toMatchObject({ content: "修改后的问题", supersedesId: original.id });
  expect(post.mock.calls[0]?.[0].coordinator?.agentId).toBe("default-agent");
  expect(container.querySelectorAll('[data-group-message]')).toHaveLength(1);
  expect(container.querySelector('[data-group-message] .chat-message')?.textContent).toBe("修改后的问题");
});

it("defers reading and marking group history until a hidden tab is opened", async () => {
  const client = new MockAgentClient(); const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  await client.postTeamChat({ teamInstanceId: instance.id, content: "notification", intent: "notify", requestId: crypto.randomUUID() });
  const mark = vi.spyOn(client, "markTeamChatRead"); const read = vi.spyOn(client, "readTeamChat"); const container = mount();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatPanel agentClient={client} teamInstanceId={instance.id} active={false} onOpenConversation={() => undefined} /></TooltipProvider>); }));
  expect(container.querySelector('[data-group-message]')).toBeNull(); expect(mark).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatPanel agentClient={client} teamInstanceId={instance.id} active onOpenConversation={() => undefined} /></TooltipProvider>); }));
  expect(container.querySelector('[data-group-message]')).not.toBeNull(); expect(read).toHaveBeenCalledOnce();
});

it("reuses cached group history and retries a refresh interrupted by a tab switch", async () => {
  const client = new MockAgentClient(); const { instance } = await groupFixture(client);
  await client.postTeamChat({ teamInstanceId: instance.id, content: "cached", intent: "notify", requestId: crypto.randomUUID() });
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(listener => { emit = listener; return () => {}; });
  const read = vi.spyOn(client, "readTeamChat"); const container = mount();
  const show = async (active: boolean) => { await act(async () => {
    root?.render(<TooltipProvider><TeamChatPanel agentClient={client} teamInstanceId={instance.id} active={active} onOpenConversation={() => undefined} /></TooltipProvider>);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }); };
  await show(true);
  const messages = container.querySelector('[aria-label="群消息"]');
  const count = read.mock.calls.length;
  await show(false); await show(true);
  expect(read).toHaveBeenCalledTimes(count);
  expect(container.querySelector('[aria-label="群消息"]')).toBe(messages);
  const page = await client.readTeamChat({ teamInstanceId: instance.id });
  let resolve: (value: typeof page) => void = () => {};
  read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  act(() => emit({ type: "collaboration.changed", conversationId: crypto.randomUUID(), teamInstanceId: instance.id }));
  await show(false);
  await act(async () => { resolve(page); await Promise.resolve(); });
  const beforeReturn = read.mock.calls.length;
  await show(true);
  expect(read).toHaveBeenCalledTimes(beforeReturn + 1);
  expect(container.textContent).toContain("cached");
});

it.each([{ intervening: 0, sameThread: false }, { intervening: 1, sameThread: false }, { intervening: 4, sameThread: false }, { intervening: 4, sameThread: true }])("quotes only after unrelated chat: $intervening / same discussion $sameThread", async ({ intervening, sameThread }) => {
  const client = new MockAgentClient(); const { instance } = await groupFixture(client);
  const member = (await client.getTeamChatMembers({ teamInstanceId: instance.id }))[0]!;
  const request = await client.postTeamChat({ teamInstanceId: instance.id, content: "原来的问题", requestId: crypto.randomUUID() });
  const messages = [request, ...Array.from({ length: intervening }, (_, index) => ({ ...request, id: crypto.randomUUID(), rootMessageId: sameThread ? request.rootMessageId : crypto.randomUUID(), sequence: index + 2, content: "中间的聊天", deliveries: [] })),
    { ...request, id: crypto.randomUUID(), sequence: intervening + 2, content: "直接回答", senderConversationId: member.conversationId, senderName: member.name, replyToId: request.id, deliveries: [] }];
  vi.spyOn(client, "readTeamChat").mockResolvedValue({ messages, nextBeforeSequence: null, userReadSequence: 0, memberReadSequence: 0 });
  const container = mount();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatPanel agentClient={client} teamInstanceId={instance.id} onOpenConversation={() => undefined} /></TooltipProvider>); }));
  const response = container.querySelector('[data-group-message][data-role="assistant"]')!;
  expect(response.textContent).toContain("直接回答");
  expect(response.textContent?.includes("回复：原来的问题")).toBe(intervening >= 4 && !sameThread);
});

it("shows only published replies without reserving a member's place while they work", async () => {
  const client = new MockAgentClient(); const { instance } = await groupFixture(client);
  const member = (await client.getTeamChatMembers({ teamInstanceId: instance.id }))[0]!;
  const request = await client.postTeamChat({ teamInstanceId: instance.id, content: "你们好", requestId: crypto.randomUUID() });
  const runId = crypto.randomUUID();
  const pending = { ...request, deliveries: [{ id: crypto.randomUUID(), conversationId: member.conversationId, runId, status: "consumed" as const, error: null }] };
  let messages = [pending];
  vi.spyOn(client, "readTeamChat").mockImplementation(() => Promise.resolve({ messages, nextBeforeSequence: null, userReadSequence: 0, memberReadSequence: 0 }));
  const listeners: Array<Parameters<MockAgentClient["onConversationRunEvent"]>[0]> = [];
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(listener => { listeners.push(listener); return () => undefined; });
  const container = mount();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatPanel agentClient={client} teamInstanceId={instance.id} onOpenConversation={() => undefined} /></TooltipProvider>); }));
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.textContent).not.toContain("正在回复");
  expect(container.textContent).not.toContain("等待回复");
  messages = [pending, { ...request, id: crypto.randomUUID(), sequence: 2, content: "你好！", senderConversationId: member.conversationId, sourceRunId: runId, deliveries: [] }];
  await act(() => Promise.resolve().then(() => { listeners.forEach(listener => listener({ type: "collaboration.changed", conversationId: member.conversationId, teamInstanceId: instance.id })); }));
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('[data-group-message][data-role="assistant"]')?.textContent).toContain("你好！");
});

it("refreshes group messages only for that room or its members", async () => {
  const client = new MockAgentClient(); const { instance } = await groupFixture(client);
  const member = (await client.getTeamChatMembers({ teamInstanceId: instance.id }))[0]!;
  const read = vi.spyOn(client, "readTeamChat");
  const listeners = new Set<Parameters<MockAgentClient["onConversationRunEvent"]>[0]>();
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; });
  mount();
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatPanel agentClient={client} teamInstanceId={instance.id} onOpenConversation={() => undefined} /></TooltipProvider>); }));
  const initialReads = read.mock.calls.length;
  await act(() => Promise.resolve().then(() => {
    listeners.forEach(listener => listener({ type: "collaboration.changed", conversationId: crypto.randomUUID(), teamInstanceId: crypto.randomUUID() }));
    listeners.forEach(listener => listener({ type: "collaboration.changed", conversationId: crypto.randomUUID() }));
  }));
  expect(read).toHaveBeenCalledTimes(initialReads);
  await act(() => Promise.resolve().then(() => { listeners.forEach(listener => listener({ type: "collaboration.changed", conversationId: member.conversationId, teamInstanceId: instance.id })); }));
  expect(read).toHaveBeenCalledTimes(initialReads + 1);
  await act(() => Promise.resolve().then(() => { listeners.forEach(listener => listener({ type: "collaboration.changed", conversationId: member.conversationId })); }));
  expect(read).toHaveBeenCalledTimes(initialReads + 2);
});

it("follows a new user message after visiting an older group source instead of repeatedly pinning that source", async () => {
  const client = new MockAgentClient(); const { instance } = await groupFixture(client);
  const original = await client.postTeamChat({ teamInstanceId: instance.id, content: "先前的消息", requestId: crypto.randomUUID() });
  let messages = [original];
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  const scrollIntoView = vi.fn();
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  try {
    vi.spyOn(client, "readTeamChat").mockImplementation(() => Promise.resolve({ messages, nextBeforeSequence: null, userReadSequence: 0, memberReadSequence: 0 }));
    const listeners: Array<Parameters<MockAgentClient["onConversationRunEvent"]>[0]> = [];
    vi.spyOn(client, "onConversationRunEvent").mockImplementation(listener => { listeners.push(listener); return () => undefined; });
    const container = mount();
    await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><TeamChatPanel agentClient={client} teamInstanceId={instance.id} focusMessageId={original.id} onOpenConversation={() => undefined} /></TooltipProvider>); }));
    const viewport = container.querySelector<HTMLElement>('[role="log"]')!;
    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 500 });
    act(() => { viewport.scrollTop = 0; viewport.dispatchEvent(new Event("scroll", { bubbles: true })); });
    messages = [original, { ...original, id: crypto.randomUUID(), sequence: 2, content: "新的问题" }];
    await act(() => Promise.resolve().then(() => { listeners.forEach(listener => listener({ type: "collaboration.changed", conversationId: instance.rootConversationId!, teamInstanceId: instance.id })); }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(viewport.scrollTop).toBe(500);
  } finally { if (previous === undefined) Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); else Object.defineProperty(HTMLElement.prototype, "scrollIntoView", previous); }
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
