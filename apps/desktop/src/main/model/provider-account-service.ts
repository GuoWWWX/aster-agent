import { providerAccountResponseSchema, type AccountProvider, type ProviderAccountRequest, type ProviderAccountResponse, type ModelCatalog } from "@agent/protocol";
import type { ModelCredentialStore } from "./model-credential-store.js";

type Adapter = {
  provider: AccountProvider;
  list(): unknown;
  connect(providerId?: string): Promise<{ providerId: string; email: string | null; authorized: boolean }>;
  disconnect(providerId: string): Promise<boolean>;
  sync(providerId: string): Promise<unknown>;
};

/** Only registered official account integrations are exposed to the renderer. */
export class ProviderAccountService {
  private readonly adapters: Map<string, Adapter>;
  public constructor(adapters: Adapter[]) {
    this.adapters = new Map();
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.provider.kind)) throw new Error("Duplicate account provider");
      this.adapters.set(adapter.provider.kind, adapter);
    }
  }
  public async execute(request: ProviderAccountRequest): Promise<ProviderAccountResponse> {
    if (request.action === "providers") return providerAccountResponseSchema.parse({ action: "providers", providers: [...this.adapters.values()].map((adapter) => adapter.provider) });
    const adapter = this.adapters.get(request.kind);
    if (adapter === undefined) throw new Error("暂不支持此账号类型。");
    switch (request.action) {
      case "list": return providerAccountResponseSchema.parse({ action: "list", connections: adapter.list() });
      case "connect": return providerAccountResponseSchema.parse({ action: "connect", ...await adapter.connect(request.providerId) });
      case "disconnect": return { action: "disconnect", revoked: await adapter.disconnect(request.providerId) };
      case "sync": return providerAccountResponseSchema.parse({ action: "sync", status: await adapter.sync(request.providerId) });
    }
  }
}

export function createProviderAccountService(credentials: ModelCredentialStore, getCatalog: () => ModelCatalog): ProviderAccountService {
  return new ProviderAccountService([{
    provider: { kind: "chatgpt", name: "ChatGPT", signInLabel: "Continue with ChatGPT", usageUrl: "https://chatgpt.com/settings/usage" },
    list: () => credentials.listChatGptConnections(),
    connect: async (id) => { const result = await credentials.connectChatGpt(id); return { providerId: result.providerId, email: result.email, authorized: result.planEnabled }; },
    disconnect: (id) => credentials.disconnectChatGpt(id),
    sync: (id) => credentials.syncChatGptModels(id, getCatalog()),
  }]);
}
