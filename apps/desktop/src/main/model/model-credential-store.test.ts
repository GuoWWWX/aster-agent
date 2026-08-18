import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    decryptString: (value: Buffer) => value.toString("utf8"),
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    isEncryptionAvailable: () => true
  }
}));

import { ModelCredentialStore } from "./model-credential-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe("ModelCredentialStore", () => {
  it("sends hi to a configured model and returns its reply", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-model-credentials-"));
    temporaryDirectories.push(directory);
    const store = new ModelCredentialStore(path.join(directory, "model-credentials.json"));
    const status = store.saveConfiguration({
      apiKey: "test-key",
      apiFormat: "openai-chat-completions",
      baseUrl: "https://example.test/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "测试模型",
        modelId: "test-model",
        reasoningOptions: [],
      }],
      providerName: "测试供应商",
    });
    const providerId = status.providerId;
    if (providerId === null) throw new Error("Expected a saved provider.");
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" }, status: 200 },
    ));
    vi.stubGlobal("fetch", request);

    await expect(store.testModelConnection(providerId, "test-model")).resolves.toEqual({
      content: "hello",
      modelId: "test-model",
    });
    expect(store.getStatus().models).toEqual([
      expect.objectContaining({ connectionStatus: "healthy", modelId: "test-model" }),
    ]);
    const requestCall = request.mock.calls[0];
    expect(requestCall?.[0]).toBe("https://example.test/v1/chat/completions");
    expect(requestCall?.[1]?.method).toBe("POST");
    expect(requestCall?.[1]?.body).toContain('"content":"hi!"');
  });

  it("migrates an existing configuration and preserves it when another provider is saved", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-model-credentials-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "model-credentials.json");
    await writeFile(
      configurationPath,
      JSON.stringify({
        baseUrl: "https://legacy.example/v1",
        defaultModelId: "legacy-model",
        encryptedApiKey: Buffer.from("legacy-key", "utf8").toString("base64"),
        models: [{ contextWindow: 32_000, modelId: "legacy-model" }],
        version: 2
      })
    );
    const store = new ModelCredentialStore(configurationPath);

    expect(store.getStatus()).toMatchObject({
      modelId: "legacy-model",
      models: [
        expect.objectContaining({
          displayName: "legacy-model",
          modelId: "legacy-model",
          providerId: "00000000-0000-4000-8000-000000000001",
          providerName: "默认供应商"
        })
      ]
    });
    expect(
      store.getConfiguration("00000000-0000-4000-8000-000000000001", "legacy-model")
    ).toEqual({
      apiKey: "legacy-key",
      apiFormat: "openai-chat-completions",
      baseUrl: "https://legacy.example/v1",
      contextWindow: 32_000,
      modelId: "legacy-model",
      reasoningOptions: []
    });

    store.saveConfiguration({
      apiKey: "second-key",
      apiFormat: "anthropic-messages",
      baseUrl: "https://second.example/v1",
      models: [{
        contextWindow: 64_000,
        displayName: "第二模型",
        modelId: "second-model",
        reasoningOptions: [{ kind: "token_budget", value: 1_024 }]
      }],
      providerName: "第二供应商"
    });

    const saved = JSON.parse(await readFile(configurationPath, "utf8")) as {
      providers: Array<{ apiFormat: string; name: string }>;
      version: number;
    };
    expect(saved.version).toBe(5);
    expect(saved.providers.map((provider) => provider.name)).toEqual([
      "默认供应商",
      "第二供应商"
    ]);
    expect(saved.providers.map((provider) => provider.apiFormat)).toEqual([
      "openai-chat-completions",
      "anthropic-messages"
    ]);
    expect(store.getStatus().models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelId: "legacy-model", providerName: "默认供应商" }),
        expect.objectContaining({
          displayName: "第二模型",
          modelId: "second-model",
          providerName: "第二供应商",
          reasoningOptions: [{ kind: "token_budget", value: 1_024 }]
        })
      ])
    );
    expect(store.getStatus()).toMatchObject({
      modelId: "legacy-model",
      providerId: "00000000-0000-4000-8000-000000000001"
    });
  });

  it("changes the global default separately and falls back when its model is removed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-model-credentials-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "model-credentials.json");
    const store = new ModelCredentialStore(configurationPath);

    const firstStatus = store.saveConfiguration({
      apiKey: "first-key",
      apiFormat: "openai-chat-completions",
      baseUrl: "https://first.example/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "第一模型",
        modelId: "first-model",
        reasoningOptions: []
      }],
      providerName: "第一供应商"
    });
    const firstProviderId = firstStatus.providerId;
    if (firstProviderId === null) throw new Error("Expected the first provider to be selected.");

    const secondStatus = store.saveConfiguration({
      apiKey: "second-key",
      apiFormat: "openai-responses",
      baseUrl: "https://second.example/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "第二模型",
        modelId: "second-model",
        reasoningOptions: []
      }],
      providerName: "第二供应商"
    });
    const secondProviderId = secondStatus.models.find(
      (model) => model.modelId === "second-model"
    )?.providerId;
    if (secondProviderId === undefined) throw new Error("Expected the second provider to be saved.");
    expect(secondStatus).toMatchObject({
      modelId: "first-model",
      providerId: firstProviderId
    });

    expect(store.setDefaultModel({
      modelId: "second-model",
      providerId: secondProviderId
    })).toMatchObject({
      modelId: "second-model",
      providerId: secondProviderId
    });
    expect(() => store.setDefaultModel({
      modelId: "first-model",
      providerId: secondProviderId
    })).toThrow("must belong to the selected provider");

    expect(store.saveConfiguration({
      apiKey: "second-key",
      apiFormat: "openai-responses",
      baseUrl: "https://second.example/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "第二模型备用",
        modelId: "second-model-fallback",
        reasoningOptions: []
      }],
      providerId: secondProviderId,
      providerName: "第二供应商"
    })).toMatchObject({
      modelId: "second-model-fallback",
      providerId: secondProviderId
    });
  });

  it("persists a model-specific context compression threshold", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-model-credentials-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "model-credentials.json");
    const store = new ModelCredentialStore(configurationPath);
    const contextCompression = {
      mode: "tokens" as const,
      percentageThreshold: 80,
      tokenThreshold: 64_000,
    };

    const status = store.saveConfiguration({
      apiKey: "model-key",
      apiFormat: "openai-responses",
      baseUrl: "https://example.test/v1",
      models: [{
        contextCompression,
        contextWindow: 128_000,
        displayName: "独立阈值模型",
        modelId: "model-with-override",
        reasoningOptions: [],
      }],
      providerNote: "用于日常开发",
      providerName: "测试供应商",
      providerWebsiteUrl: "https://example.test",
    });
    const providerId = status.providerId;
    if (providerId === null) throw new Error("Expected the provider to be selected.");

    expect(store.getConfiguration(providerId, "model-with-override")).toMatchObject({
      contextCompression,
      modelId: "model-with-override",
    });
    expect(status.models).toEqual([
      expect.objectContaining({
        contextCompression,
        modelId: "model-with-override",
        providerNote: "用于日常开发",
        providerWebsiteUrl: "https://example.test",
      }),
    ]);
  });

  it("defaults existing V3 providers to OpenAI Chat Completions", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-model-credentials-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "model-credentials.json");
    await writeFile(
      configurationPath,
      JSON.stringify({
        defaultModelId: "saved-model",
        defaultProviderId: "00000000-0000-4000-8000-000000000002",
        providers: [{
          baseUrl: "https://saved.example/v1",
          encryptedApiKey: Buffer.from("saved-key", "utf8").toString("base64"),
          id: "00000000-0000-4000-8000-000000000002",
          models: [{ contextWindow: 128_000, modelId: "saved-model" }],
          name: "已保存供应商"
        }],
        version: 3
      })
    );
    const store = new ModelCredentialStore(configurationPath);

    expect(store.getConfiguration()).toMatchObject({
      apiFormat: "openai-chat-completions",
      modelId: "saved-model"
    });
    store.saveConfiguration({
      apiKey: "saved-key",
      apiFormat: "openai-responses",
      baseUrl: "https://saved.example/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "已保存模型",
        modelId: "saved-model",
        reasoningOptions: []
      }],
      providerId: "00000000-0000-4000-8000-000000000002",
      providerName: "已保存供应商"
    });

    const saved = JSON.parse(await readFile(configurationPath, "utf8")) as {
      providers: Array<{ apiFormat: string }>;
      version: number;
    };
    expect(saved).toMatchObject({
      providers: [{ apiFormat: "openai-responses" }],
      version: 5
    });
  });

  it("migrates a V4 model's saved reasoning choice into its selectable options", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-model-credentials-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "model-credentials.json");
    const providerId = "00000000-0000-4000-8000-000000000003";
    await writeFile(
      configurationPath,
      JSON.stringify({
        defaultModelId: "gpt-5.6",
        defaultProviderId: providerId,
        providers: [{
          apiFormat: "openai-responses",
          baseUrl: "https://example.test/v1",
          encryptedApiKey: Buffer.from("saved-key", "utf8").toString("base64"),
          id: providerId,
          models: [{
            configuredReasoningEffort: "high",
            contextWindow: 128_000,
            displayName: "gpt-5.6",
            modelId: "gpt-5.6"
          }],
          name: "已保存供应商"
        }],
        version: 4
      })
    );
    const store = new ModelCredentialStore(configurationPath);

    expect(store.getStatus().models).toEqual([
      expect.objectContaining({
        modelId: "gpt-5.6",
        reasoningOptions: [{ kind: "effort", value: "high" }]
      })
    ]);

    store.saveConfiguration({
      apiKey: "saved-key",
      apiFormat: "openai-responses",
      baseUrl: "https://example.test/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "gpt-5.6",
        modelId: "gpt-5.6",
        reasoningOptions: [{ kind: "effort", value: "high" }]
      }],
      providerId,
      providerName: "已保存供应商"
    });

    await expect(readFile(configurationPath, "utf8")).resolves.toContain('"version": 5');
  });

  it("preserves a legacy GPT-5.6 reasoning choice that the provider can send", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-model-credentials-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "model-credentials.json");
    const providerId = "00000000-0000-4000-8000-000000000004";
    await writeFile(
      configurationPath,
      JSON.stringify({
        defaultModelId: "gpt-5.6",
        defaultProviderId: providerId,
        providers: [{
          apiFormat: "openai-chat-completions",
          baseUrl: "https://example.test/v1",
          encryptedApiKey: Buffer.from("saved-key", "utf8").toString("base64"),
          id: providerId,
          models: [{
            configuredReasoningEffort: "xhigh",
            contextWindow: 128_000,
            modelId: "gpt-5.6"
          }],
          name: "已保存供应商"
        }],
        version: 4
      })
    );
    const store = new ModelCredentialStore(configurationPath);

    expect(store.getStatus().models[0]?.reasoningOptions).toEqual([
      { kind: "effort", value: "xhigh" },
    ]);
  });

  it("uses each provider format's model discovery endpoint and response shape", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "claude-sonnet-4-6" }]
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        models: [{ displayName: "Gemini 2.5 Pro", name: "models/gemini-2.5-pro" }]
      }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const store = new ModelCredentialStore("unused-for-discovery.json");

    await expect(store.discoverModels({
      apiKey: "anthropic-key",
      apiFormat: "anthropic-messages",
      baseUrl: "https://api.anthropic.com/v1"
    })).resolves.toEqual([{ modelId: "claude-sonnet-4-6", ownedBy: null }]);
    expect(request.mock.calls[0]).toMatchObject([
      "https://api.anthropic.com/v1/models",
      { headers: { "anthropic-version": "2023-06-01", "x-api-key": "anthropic-key" } }
    ]);

    await expect(store.discoverModels({
      apiKey: "google-key",
      apiFormat: "google-gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta"
    })).resolves.toEqual([{ modelId: "gemini-2.5-pro", ownedBy: "Gemini 2.5 Pro" }]);
    expect(request.mock.calls[1]).toMatchObject([
      "https://generativelanguage.googleapis.com/v1beta/models",
      { headers: { "x-goog-api-key": "google-key" } }
    ]);
  });
});
