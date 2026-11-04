// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatGptConnection, ModelRuntimeStatus } from "@agent/protocol";
import { MockAgentClient } from "../../../runtime/mock-agent-client.js";
import { ChatGptProviderPanel } from "./chatgpt-provider-panel.js";

const providerId = "00000000-0000-4000-8000-000000000001";
let root: Root | null = null;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.localStorage.clear(); });
afterEach(async () => { await act(async () => { root?.unmount(); await Promise.resolve(); }); root = null; document.body.replaceChildren(); });

describe("ChatGPT provider settings", () => {
  it("connects through the desktop bridge and imports the account's models", async () => {
    const connection: ChatGptConnection = { providerId, label: "ChatGPT 1", email: "user@example.test", signedIn: true, connected: true };
    let connections: ChatGptConnection[] = [];
    const status: ModelRuntimeStatus = { baseUrl: null, configured: false, modelId: null, models: [], providerId: null,
      recentSelection: null, supportsStreaming: true, supportsTools: true };
    const client = Object.assign(new MockAgentClient(), {
      listChatGptConnections: vi.fn(() => Promise.resolve(connections)),
      connectChatGpt: vi.fn(() => { connections = [connection]; return Promise.resolve({ providerId, email: connection.email, planEnabled: true }); }),
      syncChatGptModels: vi.fn(() => Promise.resolve(status)),
      disconnectChatGpt: vi.fn(() => Promise.resolve(true)),
    });
    const onModelsChanged = vi.fn();
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = createRoot(container); root.render(<ChatGptProviderPanel agentClient={client} onModelsChanged={onModelsChanged} />); await Promise.resolve(); });
    const connect = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Continue with ChatGPT"));
    expect(connect).toBeDefined();
    await act(async () => { connect?.click(); await Promise.resolve(); });
    expect(client.connectChatGpt).toHaveBeenCalledOnce();
    expect(client.syncChatGptModels).toHaveBeenCalledWith(providerId);
    expect(onModelsChanged).toHaveBeenCalledWith(status, providerId);
    expect(container.textContent).toContain("user@example.test");
    expect(container.textContent).toContain("已授权使用 ChatGPT 套餐");
    expect(container.querySelector('a[href="https://chatgpt.com/settings/usage"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("正在使用 ChatGPT 套餐");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const manageUsage = document.querySelector<HTMLAnchorElement>('[role="dialog"] a');
    await act(async () => { manageUsage?.click(); await Promise.resolve(); });
    expect(open).toHaveBeenCalledWith("https://chatgpt.com/settings/usage", "_blank", "noopener,noreferrer");
    open.mockRestore();
    const dismiss = [...document.querySelectorAll("button")].find((button) => button.textContent === "知道了");
    await act(async () => { dismiss?.click(); await Promise.resolve(); });
    await act(async () => { connect?.click(); await Promise.resolve(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps a signed-in account visible and does not sync models without plan permission", async () => {
    const connection: ChatGptConnection = { providerId, label: "ChatGPT 1", email: "user@example.test", signedIn: true, connected: false };
    let connections: ChatGptConnection[] = [];
    const client = Object.assign(new MockAgentClient(), {
      listChatGptConnections: vi.fn(() => Promise.resolve(connections)),
      connectChatGpt: vi.fn(() => { connections = [connection]; return Promise.resolve({ providerId, email: connection.email, planEnabled: false }); }),
      syncChatGptModels: vi.fn(),
      disconnectChatGpt: vi.fn().mockResolvedValue(true),
    });
    const container = document.createElement("div"); document.body.append(container);
    await act(async () => { root = createRoot(container); root.render(<ChatGptProviderPanel agentClient={client} onModelsChanged={vi.fn()} />); await Promise.resolve(); });
    const connect = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Continue with ChatGPT"));
    await act(async () => { connect?.click(); await Promise.resolve(); });
    expect(client.syncChatGptModels).not.toHaveBeenCalled();
    expect(container.textContent).toContain("尚未授权使用 ChatGPT 套餐");
    expect(container.textContent).toContain("启用套餐");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
