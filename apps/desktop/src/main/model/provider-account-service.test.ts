import { describe, expect, it, vi } from "vitest";
import { providerAccountRequestSchema } from "@agent/protocol";
import { ProviderAccountService } from "./provider-account-service.js";
const id = "00000000-0000-4000-8000-000000000001";
function adapter(kind: string) {
  return { provider: { kind, name: kind, signInLabel: `Login ${kind}`, usageUrl: null }, list: () => [],
    connect: vi.fn(() => Promise.resolve({ providerId: id, email: null, authorized: true })), disconnect: vi.fn(() => Promise.resolve(true)), sync: vi.fn(() => Promise.resolve({})) };
}
describe("account provider routing", () => {
  it("routes another registered provider without changing the transport", async () => {
    const first = adapter("chatgpt"), second = adapter("test-provider"); const service = new ProviderAccountService([first, second]);
    expect(await service.execute({ action: "providers" })).toMatchObject({ providers: [first.provider, second.provider] });
    expect(await service.execute({ action: "connect", kind: "test-provider" })).toMatchObject({ authorized: true });
    expect(second.connect).toHaveBeenCalledOnce(); expect(first.connect).not.toHaveBeenCalled();
    await expect(service.execute({ action: "list", kind: "unknown" })).rejects.toThrow();
  });
  it("rejects malformed requests and secret fields from adapters", async () => {
    expect(providerAccountRequestSchema.safeParse({ action: "connect", kind: "chatgpt", providerId: "bad" }).success).toBe(false);
    expect(providerAccountRequestSchema.safeParse({ action: "providers", token: "secret" }).success).toBe(false);
    const bad = { ...adapter("test"), list: () => [{ providerId: id, label: "test", email: null, signedIn: true, connected: true, accessToken: "secret" }] };
    await expect(new ProviderAccountService([bad]).execute({ action: "list", kind: "test" })).rejects.toThrow();
  });
});
