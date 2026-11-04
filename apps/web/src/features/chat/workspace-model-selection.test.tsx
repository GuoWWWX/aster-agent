// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { rememberModelStatus } from "../../runtime/model-status-cache.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { ConversationWorkspace } from "./workspace-content.js";

let root: Root | null = null;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  useWorkbenchUiStore.setState({ activeActivity: "conversations" });
});
afterEach(() => {
  act(() => root?.unmount()); root = null; document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const provider = (name: string, modelId: string) => ({
  apiKey: "fixture-key", apiFormat: "openai-responses" as const, baseUrl: "https://fixture.invalid/v1",
  providerName: name, models: [{ modelId, displayName: modelId, contextWindow: 128000, reasoningOptions: [] }],
});

async function render(client: MockAgentClient): Promise<HTMLDivElement> {
  const conversation = await client.createConversation({ projectId: null });
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => {
    root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={{
      ...conversation, pinOrder: conversation.pinOrder ?? null, workspaceRootPath: null,
    }} /></TooltipProvider>);
    await new Promise(resolve => window.setTimeout(resolve, 0));
  });
  return container;
}

it("offers newly saved provider models in an already mounted conversation", async () => {
  const client = new MockAgentClient();
  await client.saveModelConfiguration(provider("Original provider", "original-model"));
  const container = await render(client);
  await act(async () => {
    rememberModelStatus(client, await client.saveModelConfiguration(provider("New provider", "new-model")));
    container.querySelector<HTMLButtonElement>('[aria-label="模型"]')?.click();
  });
  const providerSelect = document.querySelector<HTMLButtonElement>('[aria-label="筛选供应商"]');
  expect(providerSelect).not.toBeNull();
  await act(async () => { providerSelect?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await Promise.resolve(); });
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.includes("New provider"));
  expect(option).toBeDefined();
  act(() => option?.click());
  const modelOption = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="对话模型列表"] [role="option"]')].find(node => node.textContent?.includes("new-model"));
  expect(modelOption).toBeDefined();
  await act(async () => { modelOption?.click(); await Promise.resolve(); });
  expect(container.querySelector('[aria-label="模型"]')?.textContent).toBe("new-model");
});

it("filters the conversation picker to one provider and keeps selection across search", async () => {
  const client = new MockAgentClient();
  await client.saveModelConfiguration(provider("Original provider", "original-model"));
  await client.saveModelConfiguration(provider("New provider", "new-model"));
  const container = await render(client);
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="模型"]')?.click(); await Promise.resolve(); });
  const providerSelect = document.querySelector<HTMLButtonElement>('[aria-label="筛选供应商"]');
  expect(providerSelect).not.toBeNull();
  expect([...document.querySelectorAll('[aria-label="对话模型列表"] [role="option"]')].map(node => node.textContent)).toHaveLength(1);
  const currentName = providerSelect?.textContent;
  const search = document.querySelector<HTMLInputElement>('[aria-label="搜索模型"]');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, currentName);
    search?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelector('[aria-label="对话模型列表"] [role="option"]')).toBeNull();
  expect(providerSelect?.textContent).toBe(currentName);
});
