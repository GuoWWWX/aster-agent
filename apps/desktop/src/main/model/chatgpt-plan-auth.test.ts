import { safeStorage } from "electron";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

vi.mock("electron", () => ({
  safeStorage: {
    decryptString: (value: Buffer) => Buffer.from(value).reverse().toString("utf8"),
    encryptString: (value: string) => Buffer.from(value, "utf8").reverse(),
    getSelectedStorageBackend: () => "system",
    isEncryptionAvailable: () => true,
  },
}));

import { ChatGptPlanAuth, verifyChatGptIdentity } from "./chatgpt-plan-auth.js";
import { ChatGptPlanStore } from "./chatgpt-plan-store.js";
import { ModelCredentialStore } from "./model-credential-store.js";
import { SettingsJsoncFile } from "../settings/settings-jsonc-file.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-chatgpt-auth-"));
  directories.push(directory);
  const file = path.join(directory, "chatgpt.json");
  const store = new ChatGptPlanStore(file);
  let now = 1_000_000;
  const request = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
    if (!(init?.body instanceof URLSearchParams)) throw new Error("Expected a form body.");
    const form = init.body;
    if (form.get("grant_type") === "authorization_code") {
      expect(form.get("client_id")).toBe("oaiapp_issued");
      expect(form.get("resource")).toBe("https://api.openai.com/v1");
      return Promise.resolve(Response.json({ access_token: "access-secret", refresh_token: "refresh-secret", id_token: "identity-secret", token_type: "Bearer", expires_in: 3600, scope: "openid offline_access resource.invoke chatgpt.tokens.use.direct" }));
    }
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("client_id")).toBe("oaiapp_issued");
    return Promise.resolve(Response.json({ access_token: "new-access-secret", refresh_token: "rotated-refresh-secret", token_type: "Bearer", expires_in: 3600 }));
  });
  const openExternal = vi.fn(async (url: string) => {
    const authorization = new URL(url);
    expect(authorization.searchParams.get("client_id"))
      .toBe(openExternal.mock.calls.length === 1 ? "dynamic_agent_client" : "oaiapp_issued");
    expect(authorization.searchParams.get("ext_agent_host_id")).toMatch(/^urn:uuid:/u);
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.searchParams.set("state", authorization.searchParams.get("state")!);
    callback.searchParams.set("client_id", "oaiapp_issued");
    callback.searchParams.set("code", "one-time-code");
    expect((await fetch(callback)).ok).toBe(true);
  });
  const verifyIdentity = vi.fn().mockResolvedValue({ subject: "user-1", email: "user@example.test" });
  const auth = new ChatGptPlanAuth(store, { now: () => now, openExternal, request, verifyIdentity });
  return { auth, directory, file, request, store, verifyIdentity, openExternal, advance: (milliseconds: number) => { now += milliseconds; } };
}

describe("ChatGPT plan authorization", () => {
  it("registers the real client, validates identity and stores credentials encrypted", async () => {
    const { auth, file, verifyIdentity } = await fixture();
    const connection = await auth.signIn();
    expect(connection.email).toBe("user@example.test");
    expect(await auth.getAccessToken(connection.providerId)).toBe("access-secret");
    expect(verifyIdentity).toHaveBeenCalledWith("identity-secret", "oaiapp_issued", expect.any(String));
    const disk = await readFile(file, "utf8");
    expect(disk).not.toContain("access-secret");
    expect(disk).not.toContain("refresh-secret");
    expect(disk).not.toContain("identity-secret");
  });

  it("serializes refresh and persists the replacement token", async () => {
    const { auth, request, store, advance } = await fixture();
    const connection = await auth.signIn();
    advance(3_600_000);
    expect(await Promise.all([auth.getAccessToken(connection.providerId), auth.getAccessToken(connection.providerId)]))
      .toEqual(["new-access-secret", "new-access-secret"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(store.find(connection.providerId)?.refreshToken).toBe("rotated-refresh-secret");
  });

  it("clears unusable refresh credentials but retains the registered client for reauthorization", async () => {
    const { auth, request, store, advance } = await fixture();
    const connection = await auth.signIn();
    advance(3_600_000);
    request.mockResolvedValueOnce(Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(auth.getAccessToken(connection.providerId)).rejects.toThrow(/重新登录/u);
    expect(store.find(connection.providerId)).toMatchObject({
      clientId: "oaiapp_issued", subject: "user-1", accessToken: null, refreshToken: null,
    });
    expect(auth.listConnections()[0]).toMatchObject({ signedIn: false, connected: false });
  });

  it("retains credentials when a refresh fails temporarily", async () => {
    const { auth, request, store, advance } = await fixture();
    const connection = await auth.signIn();
    advance(3_600_000);
    request.mockResolvedValueOnce(Response.json({ error: "temporarily_unavailable" }, { status: 503 }));
    await expect(auth.getAccessToken(connection.providerId)).rejects.toThrow();
    expect(store.find(connection.providerId)?.refreshToken).toBe("refresh-secret");
  });

  it("verifies signature, issuer, audience and nonce of the ID token", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const publicJwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256" };
    const keys = createLocalJWKSet({ keys: [publicJwk] });
    const token = await new SignJWT({ nonce: "nonce-1", email: "user@example.test" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer("https://auth.openai.com")
      .setAudience("oaiapp_issued").setSubject("user-1").setExpirationTime("1h").sign(privateKey);
    await expect(verifyChatGptIdentity(token, "oaiapp_issued", "nonce-1", keys))
      .resolves.toEqual({ subject: "user-1", email: "user@example.test" });
    await expect(verifyChatGptIdentity(token, "wrong-client", "nonce-1", keys)).rejects.toThrow(/身份验证失败/u);
    await expect(verifyChatGptIdentity(token, "oaiapp_issued", "wrong-nonce", keys)).rejects.toThrow(/身份验证失败/u);
    const badKeys = createLocalJWKSet({ keys: [{ ...publicJwk, kid: "other-key" }] });
    await expect(verifyChatGptIdentity(token, "oaiapp_issued", "nonce-1", badKeys)).rejects.toThrow(/身份验证失败/u);
  });

  it("revokes the rotated refresh token if sign-out races an in-flight refresh", async () => {
    const { auth, request, store, advance } = await fixture();
    const connection = await auth.signIn();
    advance(3_600_000);
    let finish!: (response: Response) => void;
    request.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
    request.mockImplementationOnce((_url, init) => {
      if (!(init?.body instanceof URLSearchParams)) throw new Error("Expected a form body.");
      expect(init.body.get("token")).toBe("rotated-refresh-secret");
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    const access = auth.getAccessToken(connection.providerId);
    const signedOut = auth.signOut(connection.providerId);
    finish(Response.json({ access_token: "new-access-secret", refresh_token: "rotated-refresh-secret", token_type: "Bearer", expires_in: 3600 }));
    await expect(access).rejects.toThrow(/断开/u);
    await expect(signedOut).resolves.toBe(true);
    expect(store.find(connection.providerId)?.refreshToken).toBeNull();
  });

  it("retains a verified sign-in without enabling inference, and requests consent when the user enables plan usage", async () => {
    const { auth, request, store, openExternal } = await fixture();
    request.mockResolvedValueOnce(Response.json({ access_token: "access-secret", refresh_token: "refresh-secret", id_token: "identity-secret", token_type: "Bearer", expires_in: 3600, scope: "openid" }));
    const connection = await auth.signIn();
    expect(connection.planEnabled).toBe(false);
    expect(store.find(connection.providerId)?.subject).toBe("user-1");
    expect(auth.listConnections()[0]).toMatchObject({ signedIn: true, connected: false });
    await expect(auth.getAccessToken(connection.providerId)).rejects.toThrow(/授权/u);

    await expect(auth.signIn(connection.providerId)).resolves.toMatchObject({ planEnabled: true });
    expect(new URL(openExternal.mock.calls[1]![0]).searchParams.get("prompt")).toBe("consent");
    expect(auth.listConnections()[0]).toMatchObject({ signedIn: true, connected: true });
  });

  it("registers discovered models without placing OAuth tokens in provider settings or the IPC key", async () => {
    const { auth, directory } = await fixture();
    const connection = await auth.signIn();
    vi.spyOn(auth, "listModels").mockResolvedValue([{ modelId: "example-model", displayName: "Example" }]);
    const settings = new SettingsJsoncFile(path.join(directory, "settings.jsonc"));
    const credentials = new ModelCredentialStore(settings, undefined, auth);

    const status = await credentials.syncChatGptModels(connection.providerId);
    expect(status.models[0]).toMatchObject({ providerAuthentication: "chatgpt", modelId: "example-model" });
    expect(credentials.getApiKey(connection.providerId)).toBe("chatgpt-plan");
    const configuration = credentials.getConfiguration(connection.providerId, "example-model");
    expect(configuration.authentication?.type).toBe("chatgpt-plan");
    if (configuration.authentication?.type !== "chatgpt-plan") throw new Error("Expected ChatGPT authentication.");
    const getAccessToken = vi.spyOn(auth, "getAccessToken");
    expect(await configuration.authentication.getAccessToken()).toBe("access-secret");
    expect(getAccessToken).toHaveBeenCalledWith(connection.providerId);
    expect(credentials.getContextConfiguration(connection.providerId, "example-model"))
      .not.toHaveProperty("authentication");
    expect(await readFile(settings.path, "utf8")).not.toMatch(/(?:access|refresh|identity)-secret/u);
    expect(() => credentials.saveConfiguration({
      apiFormat: "openai-responses", apiKey: "chatgpt-plan", baseUrl: "https://attacker.example/v1",
      providerId: connection.providerId, providerName: "ChatGPT", models: [{ modelId: "example-model", displayName: "Example", contextWindow: 0, reasoningOptions: [] }],
    })).toThrow(/官方/u);
  });

  it("does not test an account-authorized image model with the API-key-only discovery endpoint", async () => {
    const { auth, directory } = await fixture();
    const connection = await auth.signIn();
    vi.spyOn(auth, "listModels").mockResolvedValue([{ modelId: "gpt-image-1", displayName: "Image" }]);
    const credentials = new ModelCredentialStore(new SettingsJsoncFile(path.join(directory, "settings.jsonc")), undefined, auth);
    await credentials.syncChatGptModels(connection.providerId);
    const discover = vi.spyOn(credentials, "discoverModels").mockResolvedValue([]);

    await expect(credentials.testModelConnection(connection.providerId, "gpt-image-1"))
      .rejects.toThrow(/账号授权.*不支持/u);
    expect(discover).not.toHaveBeenCalled();
  });
});

it("opens the official sign-in flow after recovering an inaccessible registration", async () => {
  const { auth, store, openExternal } = await fixture(); store.hostId();
  vi.spyOn(safeStorage, "decryptString").mockImplementationOnce(() => { throw new Error("ciphertext"); });
  const connected = await auth.signIn();
  expect(connected.planEnabled).toBe(true); expect(openExternal).toHaveBeenCalledOnce();
  expect(auth.listConnections()[0]?.connected).toBe(true);
});
