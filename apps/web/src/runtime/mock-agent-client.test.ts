import { afterEach, describe, expect, it, vi } from "vitest";

import { MockAgentClient } from "./mock-agent-client.js";

describe("MockAgentClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports mock capabilities and rejects desktop-only commands", async () => {
    const client = new MockAgentClient();
    await expect(client.getCapabilities()).resolves.toMatchObject({
      mode: "mock",
      workspace: false,
    });
    await expect(client.minimizeWindow()).rejects.toThrow("unavailable");
    await expect(client.toggleMaximizeWindow()).rejects.toThrow("unavailable");
    await expect(client.closeWindow()).rejects.toThrow("unavailable");
    await expect(client.addProject()).rejects.toThrow("unavailable");
  });

  it("provides a deterministic file-tree fixture without reading local files", async () => {
    const client = new MockAgentClient();
    const [project] = await client.listProjects();

    expect(project).toBeDefined();
    if (project === undefined) {
      throw new Error("The mock project fixture is missing.");
    }

    const listing = await client.listProjectEntries({
      directoryPath: "",
      projectId: project.id,
    });

    expect(listing.projectId).toBe(project.id);
    expect(listing.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "directory", name: "apps", path: "apps" }),
        expect.objectContaining({ kind: "directory", name: "doc", path: "doc" }),
      ]),
    );
    for (const entry of listing.entries) {
      expect(Number.isNaN(Date.parse(entry.modifiedAt ?? ""))).toBe(false);
    }
    await expect(
      client.readProjectFile({ path: "package.json", projectId: project.id }),
    ).resolves.toMatchObject({
      isBinary: false,
      name: "package.json",
      path: "package.json",
    });
  });

  it("creates mock project entries and exposes them through the file tree", async () => {
    const client = new MockAgentClient();
    const [project] = await client.listProjects();
    if (project === undefined) throw new Error("The mock project fixture is missing.");

    await client.createProjectEntry({
      kind: "directory",
      path: "apps/web/components",
      projectId: project.id,
    });
    await client.createProjectEntry({
      kind: "file",
      path: "apps/web/components/button.tsx",
      projectId: project.id,
    });

    await expect(client.listProjectEntries({
      directoryPath: "apps/web/components",
      projectId: project.id,
    })).resolves.toMatchObject({
      entries: [{ kind: "file", name: "button.tsx", path: "apps/web/components/button.tsx" }],
    });
    await expect(client.readProjectFile({
      path: "apps/web/components/button.tsx",
      projectId: project.id,
    })).resolves.toMatchObject({ content: "", isBinary: false });
  });

  it("manages configuration workspace files in browser previews", async () => {
    const client = new MockAgentClient();
    const workspace = { configurationId: "demo-server", kind: "mcp" as const };
    await client.saveIntegrationConfiguration({
      mcpServers: [{
        args: [],
        command: "node",
        enabled: true,
        env: {},
        headers: {},
        id: workspace.configurationId,
        name: "Demo server",
        scope: "user",
        transport: "stdio",
        url: null,
      }],
      skillDirectories: [],
      skills: [],
      version: 1,
    });

    await client.createConfigurationWorkspaceEntry({
      ...workspace,
      entryKind: "directory",
      path: "config",
    });
    await client.createConfigurationWorkspaceEntry({
      ...workspace,
      entryKind: "file",
      path: "config/server.json",
    });
    await client.writeConfigurationWorkspaceFile({
      ...workspace,
      content: '{"enabled":true}\n',
      path: "config/server.json",
    });

    await expect(client.listConfigurationWorkspaceEntries({
      ...workspace,
      directoryPath: "config",
    })).resolves.toMatchObject({
      entries: [{ kind: "file", path: "config/server.json" }],
    });
    await expect(client.readConfigurationWorkspaceFile({
      ...workspace,
      path: "config/server.json",
    })).resolves.toMatchObject({ content: '{"enabled":true}\n' });
    await client.deleteConfigurationWorkspaceEntry({ ...workspace, path: "config" });
    const rootListing = await client.listConfigurationWorkspaceEntries({
      ...workspace,
      directoryPath: "",
    });
    expect(rootListing.entries.some((entry) => entry.path === "config")).toBe(false);
    expect(rootListing.entries.some((entry) => entry.path === "mcp.json")).toBe(true);
  });

  it("manages project and conversation list state", async () => {
    const client = new MockAgentClient();
    const [project] = await client.listProjects();
    expect(project).toBeDefined();
    if (project === undefined) throw new Error("The mock project fixture is missing.");
    const conversation = await client.createConversation({ projectId: project.id });

    await expect(client.renameConversation({
      conversationId: conversation.id,
      title: "重命名后的对话",
    })).resolves.toMatchObject({ title: "重命名后的对话" });
    await expect(client.setConversationPinned({
      conversationId: conversation.id,
      pinned: true,
    })).resolves.toMatchObject({ isPinned: true });
    await expect(client.setConversationArchived({
      archived: true,
      conversationId: conversation.id,
    })).resolves.toMatchObject({ isArchived: true });
    const [archivedConversation] = await client.listConversations();
    expect(archivedConversation?.isArchived).toBe(true);
    expect(typeof archivedConversation?.archivedAt).toBe("string");
    await expect(client.setConversationArchived({
      archived: false,
      conversationId: conversation.id,
    })).resolves.toMatchObject({ archivedAt: null, isArchived: false });
    await client.deleteConversation({ conversationId: conversation.id });
    await expect(client.listConversations()).resolves.toEqual([]);

    await expect(client.renameProject({
      name: "重命名后的项目",
      projectId: project.id,
    })).resolves.toMatchObject({ name: "重命名后的项目" });
    await expect(client.setProjectPinned({
      pinned: true,
      projectId: project.id,
    })).resolves.toMatchObject({ isPinned: true });
    await expect(client.setProjectTeamsInNavigator({
      projectId: project.id,
      showTeamsInNavigator: true,
    })).resolves.toMatchObject({ showTeamsInNavigator: true });
    await client.removeProject({ projectId: project.id });
    await expect(client.listProjects()).resolves.toEqual([]);
  });

  it("keeps custom Team instance ordering in the mock runtime", async () => {
    const client = new MockAgentClient();
    const teams = (await client.getApplicationSettings()).agentDirectory.teams;
    const firstTeam = teams[0];
    const secondTeam = teams[1];
    if (firstTeam === undefined || secondTeam === undefined) {
      throw new Error("The mock Team templates are missing.");
    }
    const first = await client.createTeamInstance({ scope: "global", teamId: firstTeam.id });
    const second = await client.createTeamInstance({ scope: "global", teamId: secondTeam.id });

    await expect(client.reorderTeamInstances({
      teamInstanceIds: [second.id, first.id],
    })).resolves.toMatchObject([{ id: second.id }, { id: first.id }]);
  });

  it("creates and reuses a durable shared Team member conversation", async () => {
    const client = new MockAgentClient();

    const first = await client.ensureTeamMemberConversation({
      agentId: "frontend-engineer",
      teamId: "default-team",
    });
    const second = await client.ensureTeamMemberConversation({
      agentId: "frontend-engineer",
      teamId: "default-team",
    });

    expect(first.lead).toMatchObject({
      agentId: "team-lead",
      parentConversationId: null,
      projectId: null,
      threadKind: "team_lead",
    });
    expect(first.member).toMatchObject({
      agentId: "frontend-engineer",
      parentConversationId: first.lead.id,
      projectId: null,
      threadKind: "agent",
    });
    expect(second.member.id).toBe(first.member.id);
    expect(second.lead.id).toBe(first.lead.id);
  });

  it("keeps conversations in the order they were pinned", async () => {
    const client = new MockAgentClient();
    const first = await client.createConversation({});
    const second = await client.createConversation({});

    await client.setConversationPinned({ conversationId: first.id, pinned: true });
    await client.setConversationPinned({ conversationId: second.id, pinned: true });
    await expect(client.listConversations()).resolves.toMatchObject([
      { id: first.id },
      { id: second.id },
    ]);

    await client.setConversationPinned({ conversationId: first.id, pinned: false });
    await client.setConversationPinned({ conversationId: first.id, pinned: true });
    await expect(client.listConversations()).resolves.toMatchObject([
      { id: second.id },
      { id: first.id },
    ]);
  });

  it("reorders conversations inside their current group", async () => {
    const client = new MockAgentClient();
    const first = await client.createConversation({});
    const second = await client.createConversation({});
    const third = await client.createConversation({});

    await expect(client.reorderConversations({
      conversationIds: [first.id, third.id, second.id],
    })).resolves.toMatchObject([
      { id: first.id },
      { id: third.id },
      { id: second.id },
    ]);
  });

  it("provides an in-memory conversation runtime for browser previews", async () => {
    vi.useFakeTimers();
    const client = new MockAgentClient();
    const [project] = await client.listProjects();

    expect(project).toBeDefined();
    if (project === undefined) {
      throw new Error("The mock project fixture is missing.");
    }

    const events: string[] = [];
    let startedModelId: string | null = null;
    const unsubscribe = client.onConversationRunEvent((event) => {
      events.push(event.type);
      if (event.type === "run.started") {
        startedModelId = event.modelId;
      }
    });
    const conversation = await client.createConversation({
      projectId: project.id,
    });
    const accepted = await client.sendConversationMessage({
      content: "检查项目结构",
      conversationId: conversation.id,
      modelId: "preview-model",
      permissionMode: "read_only",
      reasoning: { kind: "effort", value: "high" },
    });
    expect(accepted.kind).toBe("started");
    if (accepted.kind !== "started") {
      throw new Error("The mock runtime did not start the first message.");
    }
    await expect(client.listConversations()).resolves.toEqual([
      expect.objectContaining({
        activeRunId: accepted.runId,
        lastRunStatus: "running",
      }),
    ]);
    await vi.advanceTimersByTimeAsync(800);

    const timeline = await client.listConversationTimeline({
      conversationId: conversation.id,
    });
    unsubscribe();

    expect(accepted.userMessage.content).toBe("检查项目结构");
    expect(timeline).toHaveLength(2);
    const assistantMessage = timeline[1];
    expect(assistantMessage?.kind).toBe("message");
    if (assistantMessage?.kind !== "message") {
      throw new Error("The mock runtime did not create an assistant message.");
    }
    expect(assistantMessage.content).toContain("浏览器预览模式");
    expect(assistantMessage.modelId).toBe("preview-model");
    expect(assistantMessage.role).toBe("assistant");
    expect(startedModelId).toBe("preview-model");
    await expect(client.listConversations()).resolves.toEqual([
      expect.objectContaining({
        activeRunId: null,
        hasUnreadResult: true,
        lastRunStatus: "completed",
      }),
    ]);
    await expect(
      client.markConversationResultViewed({ conversationId: conversation.id }),
    ).resolves.toMatchObject({ hasUnreadResult: false });
    expect(events).toEqual([
      "conversation.updated",
      "run.started",
      "assistant.reasoning_delta",
      "assistant.delta",
      "run.finished",
    ]);
  });

  it("keeps pending message identity and position while editing and reordering", async () => {
    vi.useFakeTimers();
    const client = new MockAgentClient();
    const conversation = await client.createConversation({
      agent: {
        id: "reviewer",
        instructions: "保持审查上下文连续。",
        isDefault: false,
        name: "Reviewer",
        role: "代码审查",
      },
    });
    await client.sendConversationMessage({
      content: "当前消息",
      conversationId: conversation.id,
    });
    const second = await client.sendConversationMessage({
      content: "原第二条",
      conversationId: conversation.id,
      referencedProjectPaths: ["src/index.ts"],
    });
    const third = await client.sendConversationMessage({
      content: "第三条",
      conversationId: conversation.id,
    });
    if (second.kind !== "pending" || third.kind !== "pending") {
      throw new Error("The mock runtime did not queue messages during an active run.");
    }

    await client.reorderConversationPendingMessages({
      conversationId: conversation.id,
      pendingMessageIds: [third.pendingMessage.id, second.pendingMessage.id],
    });
    const edited = await client.updateConversationPendingMessage({
      content: "第二条编辑后",
      pendingMessageId: second.pendingMessage.id,
    });

    expect(edited.map((message) => [message.id, message.content])).toEqual([
      [third.pendingMessage.id, "第三条"],
      [second.pendingMessage.id, "第二条编辑后"],
    ]);
    expect(edited[1]?.referencedProjectPaths).toEqual(["src/index.ts"]);
    await vi.advanceTimersByTimeAsync(2_400);
    const timeline = await client.listConversationTimeline({ conversationId: conversation.id });
    expect(timeline.filter((item) => item.kind === "message" && item.role === "user")
      .map((item) => item.kind === "message" ? item.content : "")).toEqual([
      "当前消息",
      "第三条",
      "第二条编辑后",
    ]);
  });

  it("creates temporary conversations without a project", async () => {
    const client = new MockAgentClient();
    const conversation = await client.createConversation({});

    expect(conversation.threadKind).toBe("agent");

    await expect(
      client.getConversationContextUsage({
        conversationId: conversation.id,
        permissionMode: "ask_before_changes",
      }),
    ).resolves.toMatchObject({
      estimatedInputTokens: expect.any(Number) as number,
      outputReserveTokens: 8_192,
    });

    expect(conversation.projectId).toBeNull();
    await expect(
      client.sendConversationMessage({
        content: "临时对话",
        conversationId: conversation.id,
      }),
    ).resolves.toMatchObject({ userMessage: { conversationId: conversation.id } });
  });

  it("includes referenced conversation history in mock context usage", async () => {
    vi.useFakeTimers();
    const client = new MockAgentClient();
    const source = await client.createConversation({});
    await client.sendConversationMessage({
      content: "来源对话内容",
      conversationId: source.id,
    });
    await vi.advanceTimersByTimeAsync(800);
    const current = await client.createConversation({});

    const withoutReference = await client.getConversationContextUsage({
      conversationId: current.id,
      permissionMode: "ask_before_changes",
    });
    const withReference = await client.getConversationContextUsage({
      conversationId: current.id,
      permissionMode: "ask_before_changes",
      referencedConversationIds: [source.id],
    });

    expect(withReference.estimatedReferenceTokens).toBeGreaterThan(0);
    expect(withReference.estimatedInputTokens).toBe(
      withoutReference.estimatedInputTokens + withReference.estimatedReferenceTokens,
    );
  });

  it("changes and clears a new conversation project", async () => {
    const client = new MockAgentClient();
    const [project] = await client.listProjects();
    if (project === undefined) throw new Error("The mock project fixture is missing.");
    const conversation = await client.createConversation({});

    await expect(client.setConversationProject({
      conversationId: conversation.id,
      projectId: project.id,
    })).resolves.toMatchObject({ projectId: project.id });
    await expect(client.setConversationProject({
      conversationId: conversation.id,
      projectId: null,
    })).resolves.toMatchObject({ projectId: null });
  });

  it("forks side-chat context without exposing or mutating it as a main conversation", async () => {
    vi.useFakeTimers();
    const client = new MockAgentClient();
    const conversation = await client.createConversation({});
    await client.sendConversationMessage({
      content: "主对话上下文",
      conversationId: conversation.id,
    });
    await vi.advanceTimersByTimeAsync(800);
    const sourceTimeline = await client.listConversationTimeline({
      conversationId: conversation.id,
    });

    const fork = await client.forkConversation({ conversationId: conversation.id });
    expect(fork.threadKind).toBe("agent");
    expect(fork.agentId).toBe(conversation.agentId);
    await expect(client.listConversations()).resolves.toHaveLength(1);
    await expect(
      client.listConversationForks({ conversationId: conversation.id }),
    ).resolves.toEqual([fork]);
    await expect(
      client.listConversationTimeline({ conversationId: fork.id }),
    ).resolves.toEqual([]);
    await expect(
      client.getConversationContextUsage({
        conversationId: fork.id,
        permissionMode: "ask_before_changes",
      }),
    ).resolves.toMatchObject({ includedMessageCount: sourceTimeline.length });

    await client.sendConversationMessage({
      content: "侧边聊天新消息",
      conversationId: fork.id,
    });
    expect(
      await client.listConversationTimeline({ conversationId: conversation.id }),
    ).toEqual(sourceTimeline);
  });

  it("removes a deleted side chat from its parent fork list", async () => {
    const client = new MockAgentClient();
    const conversation = await client.createConversation({});
    const sideChat = await client.forkConversation({ conversationId: conversation.id });

    await client.deleteConversation({ conversationId: sideChat.id });

    await expect(
      client.listConversationForks({ conversationId: conversation.id }),
    ).resolves.toEqual([]);
  });

  it("creates a numbered mock sibling conversation through the selected reply", async () => {
    vi.useFakeTimers();
    const client = new MockAgentClient();
    const conversation = await client.createConversation({});
    await client.sendConversationMessage({
      content: "第一轮问题",
      conversationId: conversation.id,
    });
    await vi.advanceTimersByTimeAsync(800);
    const firstTimeline = await client.listConversationTimeline({
      conversationId: conversation.id,
    });
    const firstAssistant = firstTimeline.find(
      (item) => item.kind === "message" && item.role === "assistant",
    );
    if (firstAssistant?.kind !== "message") throw new Error("Expected an assistant reply.");

    await client.sendConversationMessage({
      content: "第二轮问题",
      conversationId: conversation.id,
    });
    await vi.advanceTimersByTimeAsync(800);
    const fullTimeline = await client.listConversationTimeline({
      conversationId: conversation.id,
    });
    expect(fullTimeline.length).toBeGreaterThan(firstTimeline.length);

    const fork = await client.forkConversation({
      conversationId: conversation.id,
      throughMessageId: firstAssistant.id,
    });
    const secondFork = await client.forkConversation({
      conversationId: conversation.id,
      throughMessageId: firstAssistant.id,
    });

    expect(fork).toMatchObject({
      parentConversationId: null,
      projectId: conversation.projectId,
      threadKind: "agent",
      title: "第一轮问题 (1)",
    });
    expect(secondFork.title).toBe("第一轮问题 (2)");
    await expect(client.listConversations()).resolves.toHaveLength(3);
    await expect(client.listConversationForks({ conversationId: conversation.id }))
      .resolves.toEqual([]);
    const forkTimeline = await client.listConversationTimeline({ conversationId: fork.id });
    expect(forkTimeline.map((item) => item.kind === "tool"
      ? item.name
      : item.kind === "model_retry" ? item.reason : item.content)).toEqual(
      firstTimeline.map((item) => item.kind === "tool"
        ? item.name
        : item.kind === "model_retry" ? item.reason : item.content),
    );
    expect(forkTimeline.every((item) => item.conversationId === fork.id)).toBe(true);
    expect(forkTimeline.every((item) => item.runId !== null)).toBe(true);
    expect(new Set(forkTimeline.map((item) => item.runId)).size).toBe(1);
    expect(forkTimeline.map((item) => item.id)).not.toEqual(
      firstTimeline.map((item) => item.id),
    );
    const copiedAssistant = forkTimeline.find(
      (item) => item.kind === "message" && item.role === "assistant",
    );
    if (copiedAssistant?.kind !== "message") throw new Error("Expected copied assistant reply.");
    const nestedFork = await client.forkConversation({
      conversationId: fork.id,
      throughMessageId: copiedAssistant.id,
    });
    const nestedTimeline = await client.listConversationTimeline({
      conversationId: nestedFork.id,
    });
    expect(nestedTimeline.map((item) => item.kind === "tool"
      ? item.name
      : item.kind === "model_retry" ? item.reason : item.content)).toEqual(
      firstTimeline.map((item) => item.kind === "tool"
        ? item.name
        : item.kind === "model_retry" ? item.reason : item.content),
    );
    expect(nestedTimeline.map((item) => item.id)).not.toEqual(
      forkTimeline.map((item) => item.id),
    );
    await expect(client.getConversationContextUsage({
      conversationId: fork.id,
      permissionMode: "ask_before_changes",
    })).resolves.toMatchObject({ includedMessageCount: firstTimeline.length });
    await client.sendConversationMessage({
      content: "从分叉位置继续",
      conversationId: fork.id,
    });
    expect((await client.listConversations()).find(
      (candidate) => candidate.id === fork.id,
    )?.title).toBe("第一轮问题 (1)");
    await vi.advanceTimersByTimeAsync(800);
    const firstUser = firstTimeline.find(
      (item) => item.kind === "message" && item.role === "user",
    );
    if (firstUser === undefined) throw new Error("Expected a user message.");
    await expect(client.forkConversation({
      conversationId: conversation.id,
      throughMessageId: firstUser.id,
    })).rejects.toThrow("completed assistant message");
  });

  it("supports managed Skill and MCP configuration workspaces in browser preview", async () => {
    const client = new MockAgentClient();
    const skillDocument = await client.createSkillDocument();
    await client.saveIntegrationConfiguration({
      mcpServers: [{
        args: ["-y", "@example/mcp"],
        command: "npx",
        enabled: true,
        env: {},
        headers: {},
        id: "preview-mcp",
        name: "Preview MCP",
        scope: "user",
        transport: "stdio",
        url: null,
      }],
      skillDirectories: [],
      skills: [{
        description: skillDocument.metadata.description,
        enabled: true,
        entryPath: skillDocument.entryPath,
        id: "preview-skill",
        mcpDependencies: [],
        name: skillDocument.metadata.name,
        scope: "user",
        version: "",
      }],
      version: 1,
    });

    const skillRoot = await client.listConfigurationWorkspaceEntries({
      configurationId: "preview-skill",
      directoryPath: "",
      kind: "skill",
    });
    expect(skillRoot.entries.some((entry) => (
      entry.kind === "directory" && entry.path === "scripts"
    ))).toBe(true);
    expect(skillRoot.entries.some((entry) => (
      entry.isProtected && entry.path === "SKILL.md"
    ))).toBe(true);
    await client.createConfigurationWorkspaceEntry({
      configurationId: "preview-skill",
      entryKind: "file",
      kind: "skill",
      path: "scripts/inspect.ts",
    });
    await client.writeConfigurationWorkspaceFile({
      configurationId: "preview-skill",
      content: "export const inspect = true;\n",
      kind: "skill",
      path: "scripts/inspect.ts",
    });
    await expect(client.readConfigurationWorkspaceFile({
      configurationId: "preview-skill",
      kind: "skill",
      path: "scripts/inspect.ts",
    })).resolves.toMatchObject({ content: "export const inspect = true;\n" });
    await client.deleteConfigurationWorkspaceEntry({
      configurationId: "preview-skill",
      kind: "skill",
      path: "scripts/inspect.ts",
    });
    await expect(client.deleteConfigurationWorkspaceEntry({
      configurationId: "preview-skill",
      kind: "skill",
      path: "SKILL.md",
    })).rejects.toThrow(/cannot be deleted/i);

    const mcpDocument = await client.readConfigurationWorkspaceFile({
      configurationId: "preview-mcp",
      kind: "mcp",
      path: "mcp.json",
    });
    const mcp = JSON.parse(mcpDocument.content ?? "{}") as Record<string, unknown>;
    await client.writeConfigurationWorkspaceFile({
      configurationId: "preview-mcp",
      content: JSON.stringify({ ...mcp, name: "Updated Preview MCP" }),
      kind: "mcp",
      path: "mcp.json",
    });
    await expect(client.getIntegrationConfiguration()).resolves.toMatchObject({
      mcpServers: [expect.objectContaining({ id: "preview-mcp", name: "Updated Preview MCP" })],
    });
  });

  it("keeps a saved API key available to the settings password field", async () => {
    const client = new MockAgentClient();

    const status = await client.saveModelConfiguration({
      apiKey: "preview-api-key",
      apiFormat: "google-gemini",
      baseUrl: "https://example.test/v1",
      models: [{
        contextWindow: 128000,
        displayName: "gpt-5.6",
        modelId: "gpt-5.6",
        reasoningOptions: [{ kind: "token_budget", value: 4_096 }]
      }],
      providerIcon: "deepseek",
      providerName: "预览供应商",
    });

    expect(status.providerId).not.toBeNull();
    if (status.providerId === null) throw new Error("Expected a saved provider.");
    await expect(client.getModelApiKey(status.providerId)).resolves.toBe("preview-api-key");
    await expect(client.testModelConnection({
      modelId: "gpt-5.6",
      providerId: status.providerId,
    })).resolves.toMatchObject({ content: "Hi! gpt-5.6 连接正常。" });
    await expect(client.getModelStatus()).resolves.toMatchObject({
      models: [expect.objectContaining({
        connectionStatus: "healthy",
        modelId: "gpt-5.6",
        providerIcon: "deepseek",
      })],
    });
  });

  it("keeps the mock global default stable while another provider is saved", async () => {
    const client = new MockAgentClient();
    const firstStatus = await client.saveModelConfiguration({
      apiKey: "first-key",
      apiFormat: "openai-chat-completions",
      baseUrl: "https://first.example/v1",
      models: [{
        contextWindow: 128000,
        displayName: "第一模型",
        modelId: "first-model",
        reasoningOptions: []
      }],
      providerName: "第一供应商",
    });
    const firstProviderId = firstStatus.providerId;
    if (firstProviderId === null) throw new Error("Expected a saved provider.");

    const secondStatus = await client.saveModelConfiguration({
      apiKey: "second-key",
      apiFormat: "openai-responses",
      baseUrl: "https://second.example/v1",
      models: [{
        contextWindow: 128000,
        displayName: "第二模型",
        modelId: "second-model",
        reasoningOptions: []
      }],
      providerName: "第二供应商",
    });
    const secondProviderId = secondStatus.models.find(
      (model) => model.modelId === "second-model",
    )?.providerId;
    if (secondProviderId === undefined) throw new Error("Expected a second provider.");
    expect(secondStatus).toMatchObject({
      modelId: "first-model",
      providerId: firstProviderId,
    });

    await expect(client.setDefaultModel({
      modelId: "second-model",
      providerId: secondProviderId,
    })).resolves.toMatchObject({
      modelId: "second-model",
      providerId: secondProviderId,
    });
  });

  it("inherits the latest user model selection into new and side conversations", async () => {
    const client = new MockAgentClient();
    const status = await client.saveModelConfiguration({
      apiKey: "test-key",
      apiFormat: "openai-responses",
      baseUrl: "https://example.test/v1",
      models: [
        {
          contextWindow: 128000,
          displayName: "默认模型",
          modelId: "fallback-model",
          reasoningOptions: [],
        },
        {
          contextWindow: 128000,
          displayName: "最近模型",
          modelId: "recent-model",
          reasoningOptions: [{ kind: "effort", value: "high" }],
        },
      ],
      providerName: "测试供应商",
    });
    if (status.providerId === null) throw new Error("Expected a saved provider.");
    const first = await client.createConversation({});
    const selection = {
      modelId: "recent-model",
      providerId: status.providerId,
      reasoning: { kind: "effort" as const, value: "high" as const },
    };

    await expect(client.setConversationModelSelection({
      conversationId: first.id,
      modelSelection: selection,
    })).resolves.toMatchObject({ modelSelection: selection });
    await expect(client.createConversation({})).resolves.toMatchObject({
      modelSelection: selection,
    });
    const side = await client.forkConversation({ conversationId: first.id });
    expect(side).toMatchObject({ modelSelection: selection });

    const fallbackSelection = {
      modelId: "fallback-model",
      providerId: status.providerId,
      reasoning: null,
    };
    await client.setConversationModelSelection({
      conversationId: first.id,
      modelSelection: fallbackSelection,
    });

    await expect(client.listConversationForks({ conversationId: first.id })).resolves.toEqual([
      expect.objectContaining({
        id: side.id,
        modelSelection: selection,
      }),
    ]);
    await expect(client.listConversations()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: first.id,
        modelSelection: fallbackSelection,
      }),
    ]));
  });
});
