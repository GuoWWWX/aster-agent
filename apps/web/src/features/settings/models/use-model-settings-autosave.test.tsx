// @vitest-environment jsdom

import { act, useEffect, type ChangeEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION, type ModelRuntimeStatus, type SaveModelConfigurationInput } from "@agent/protocol";
import { MockAgentClient } from "../../../runtime/mock-agent-client.js";
import { useModelSettingsController } from "./use-model-settings-controller.js";

let root: Root | null = null;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
});
afterEach(async () => {
  await act(async () => { root?.unmount(); await Promise.resolve(); });
  root = null; document.body.replaceChildren();
  vi.useRealTimers(); vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let count = 0; count < 20; count++) await Promise.resolve();
}

async function fixture(client = new MockAgentClient(), prepare?: (client: MockAgentClient) => Promise<void>) {
  await client.saveModelConfiguration({ apiKey: "test-key", apiFormat: "openai-responses",
    baseUrl: "https://example.test/v1", providerName: "Original provider",
    models: [{ contextWindow: 128000, displayName: "Example", modelId: "example-model", reasoningOptions: [] }] });
  await prepare?.(client);
  let controller!: ReturnType<typeof useModelSettingsController>;
  function Harness() {
    controller = useModelSettingsController({ agentClient: client });
    const setCompression = controller.handleGlobalContextCompressionChange;
    useEffect(() => setCompression(DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION), [setCompression]);
    return null;
  }
  const container = document.createElement("div"); document.body.append(container);
  async function mount() {
    root = createRoot(container);
    await act(async () => { root?.render(<Harness />); await settle(); });
  }
  async function leave() {
    await act(async () => { root?.unmount(); root = null; await settle(); });
  }
  await mount();
  expect(controller.draft.apiKey).toBe("test-key");
  function editName(name: string) {
    const input = document.createElement("input"); input.name = "providerName"; input.value = name;
    act(() => controller.updateDraft({ target: input } as ChangeEvent<HTMLInputElement>));
  }
  return { client, current: () => controller, editName, mount, leave };
}

it("flushes the last complete edit when leaving before the autosave delay", async () => {
  const f = await fixture();
  const save = vi.spyOn(f.client, "saveModelConfiguration");
  f.editName("Saved on leave");
  expect(save).not.toHaveBeenCalled();
  await f.leave();
  expect(save).toHaveBeenCalledTimes(1);
  expect((await f.client.getModelStatus()).models[0]?.providerName).toBe("Saved on leave");
});

it("keeps the 450ms debounce and sends only the latest continuous edit", async () => {
  const f = await fixture(); const save = vi.spyOn(f.client, "saveModelConfiguration");
  f.editName("First");
  await act(async () => vi.advanceTimersByTimeAsync(300));
  f.editName("Latest");
  await act(async () => vi.advanceTimersByTimeAsync(449));
  expect(save).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ providerName: "Latest" }));
});

it("serializes a final edit behind an in-flight save after leaving", async () => {
  const f = await fixture(); const write = f.client.saveModelConfiguration.bind(f.client);
  let finishFirst!: (status: ModelRuntimeStatus) => void;
  const save = vi.spyOn(f.client, "saveModelConfiguration")
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
  f.editName("First");
  await act(async () => vi.advanceTimersByTimeAsync(450));
  f.editName("Final"); await f.leave();
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { finishFirst(await write(save.mock.calls[0]![0])); await settle(); });
  expect(save).toHaveBeenCalledTimes(2);
  expect((await f.client.getModelStatus()).models[0]?.providerName).toBe("Final");
});

it("waits for the previous page's write before hydrating a newly mounted editor", async () => {
  const f = await fixture(); const write = f.client.saveModelConfiguration.bind(f.client);
  let finish!: (status: ModelRuntimeStatus) => void;
  const save = vi.spyOn(f.client, "saveModelConfiguration")
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  f.editName("Pending page");
  await act(async () => vi.advanceTimersByTimeAsync(450));
  await f.leave(); await f.mount();
  await act(async () => { finish(await write(save.mock.calls[0]![0])); await settle(); });
  expect(f.current().draft.providerName).toBe("Pending page");
  expect(f.current().providerSaveState).not.toBe("pending");
});

it("restores a failed complete draft on reentry and clears its error after a successful edit", async () => {
  const f = await fixture();
  const save = vi.spyOn(f.client, "saveModelConfiguration").mockRejectedValueOnce(new Error("Save failed"));
  f.editName("Retry this draft"); await f.leave();
  expect(save).toHaveBeenCalledTimes(1);
  await f.mount();
  expect(f.current().draft.providerName).toBe("Retry this draft");
  expect(f.current().operationError).toBe("模型配置更新失败");
  f.editName("Recovered");
  await act(async () => vi.advanceTimersByTimeAsync(450));
  expect(f.current().operationError).toBeNull();
  expect((await f.client.getModelStatus()).models[0]?.providerName).toBe("Recovered");
});

it("does not put an old provider's failed save into another provider's editor", async () => {
  const f = await fixture(new MockAgentClient(), async client => {
    await client.saveModelConfiguration({ apiKey: "second-key", apiFormat: "openai-responses",
      baseUrl: "https://second.test/v1", providerName: "Second provider",
      models: [{ contextWindow: 128000, displayName: "Second", modelId: "second-model", reasoningOptions: [] }] });
  });
  let fail!: (reason: Error) => void;
  vi.spyOn(f.client, "saveModelConfiguration").mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  f.editName("Failed original");
  await act(async () => vi.advanceTimersByTimeAsync(450));
  const secondId = f.current().providers.find(provider => provider.name === "Second provider")!.id;
  await act(async () => { f.current().setActiveProviderId(secondId); await settle(); });
  await act(async () => { fail(new Error("Old provider failed")); await settle(); });
  expect(f.current().draft.providerName).toBe("Second provider");
  expect(f.current().draft.apiKey).toBe("second-key");
  expect(f.current().operationError).toBeNull();
});

it.each(["https://example.test/v1", "https://example.test/v1/", "  https://EXAMPLE.test/v1/  "])("keeps a new provider's final edit on the same provider after normalizing %s", async baseUrl => {
  const f = await fixture();
  const draft = { ...f.current().draft, baseUrl, providerName: "New provider first" };
  const models = [...f.current().configuredModelDrafts];
  act(() => f.current().createProvider());
  act(() => { f.current().setDraft(draft); f.current().setConfiguredModelDrafts(models); f.current().markProviderConfigurationChanged(); });
  const originalWrite = f.client.saveModelConfiguration.bind(f.client);
  const write = (input: SaveModelConfigurationInput) => originalWrite({ ...input,
    baseUrl: new URL(input.baseUrl.trim()).toString().replace(/\/$/, "") });
  let finish!: (status: ModelRuntimeStatus) => void;
  const save = vi.spyOn(f.client, "saveModelConfiguration").mockImplementation(write)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => vi.advanceTimersByTimeAsync(450));
  f.editName("New provider final"); await f.leave();
  await act(async () => { finish(await write(save.mock.calls[0]![0])); await settle(); });
  const status = await f.client.getModelStatus();
  expect(new Set(status.models.map(model => model.providerId)).size).toBe(2);
  expect(status.models.some(model => model.providerName === "New provider final")).toBe(true);
  expect(status.models.some(model => model.providerName === "New provider first")).toBe(false);
});

it("does not recreate a deleted provider from a pending autosave", async () => {
  const f = await fixture(); const save = vi.spyOn(f.client, "saveModelConfiguration");
  const providerId = f.current().selectedProviderId!;
  f.editName("Discard when deleting");
  await act(async () => { await f.current().deleteProvider(providerId); await settle(); });
  await act(async () => vi.advanceTimersByTimeAsync(450));
  await f.leave();
  expect(save).not.toHaveBeenCalled();
  expect((await f.client.getModelStatus()).models.some(model => model.providerId === providerId)).toBe(false);
});

it("saves a pending configuration before changing the default model", async () => {
  const f = await fixture(); const save = vi.spyOn(f.client, "saveModelConfiguration");
  const setDefault = vi.spyOn(f.client, "setDefaultModel");
  f.editName("Persist before default");
  await act(async () => { await f.current().setDefaultModel(f.current().status!.models[0]!); await settle(); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(setDefault).toHaveBeenCalledTimes(1);
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(setDefault.mock.invocationCallOrder[0]!);
  expect((await f.client.getModelStatus()).models[0]?.providerName).toBe("Persist before default");
});
