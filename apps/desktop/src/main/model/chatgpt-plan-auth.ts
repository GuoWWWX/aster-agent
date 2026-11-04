import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { type ChatGptConnection, ChatGptPlanStore } from "./chatgpt-plan-store.js";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const TOKEN_ENDPOINT = `${ISSUER}/api/accounts/oauth/token`;
const SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const INVALID_REFRESH_CODES = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);
const remoteKeys = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  token_type: z.string().regex(/^bearer$/iu),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
}).passthrough();
const modelsSchema = z.object({ models: z.array(z.object({
  slug: z.string().trim().min(1).max(200),
  display_name: z.string().trim().min(1).max(200),
  visibility: z.string(),
}).passthrough()) }).passthrough();

type Identity = { subject: string; email: string | null };
class ChatGptOAuthError extends Error {
  public constructor(public readonly oauthCode: string | null, status: number) {
    super(status >= 500
      ? `ChatGPT 授权服务暂时不可用（${status}），请稍后重试。`
      : `ChatGPT 授权失败（${status}），请检查账号和应用配置。`);
  }
}
type AuthDependencies = {
  now?: () => number;
  openExternal(url: string): Promise<void>;
  request?: typeof fetch;
  verifyIdentity?: (token: string, clientId: string, nonce: string) => Promise<Identity>;
};

export async function verifyChatGptIdentity(token: string, clientId: string, nonce: string,
  keys: JWTVerifyGetKey = remoteKeys): Promise<Identity> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      issuer: ISSUER, audience: clientId, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "nonce"],
    }));
  } catch { throw new Error("ChatGPT 身份验证失败，请重新登录。"); }
  if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.nonce !== nonce) {
    throw new Error("ChatGPT 身份验证失败，请重新登录。");
  }
  return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
}

function randomValue(): string { return randomBytes(32).toString("base64url"); }
function hasPlanPermission(scopes: readonly string[]): boolean {
  return scopes.includes("chatgpt.tokens.use.direct") && scopes.includes("resource.invoke");
}

type Callback = { code: string; clientId: string };

async function listenForCallback(state: string, registeredClientId: string | null): Promise<{
  redirectUri: string;
  result: Promise<Callback>;
  close(): void;
}> {
  let resolveResult!: (callback: Callback) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<Callback>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  // The browser can return before openExternal resolves; keep early rejection observed.
  void result.catch(() => undefined);
  let done = false;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/auth/callback" || done
      || url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state) {
      res.writeHead(400).end("Invalid authorization callback.");
      return;
    }
    done = true;
    const code = url.searchParams.get("code");
    const returnedClientId = url.searchParams.get("client_id");
    const clientId = returnedClientId ?? registeredClientId;
    if (url.searchParams.has("error") || code === null || code.length === 0 || clientId === null
      || clientId === "dynamic_agent_client" || (registeredClientId !== null && clientId !== registeredClientId)
      || url.searchParams.getAll("code").length !== 1 || url.searchParams.getAll("client_id").length > 1) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("Authorization was not completed. Return to Aster.");
      rejectResult(new Error("ChatGPT 授权未完成，请返回软件重试。"));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("Authorization received. You can return to Aster.");
    resolveResult({ code, clientId });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  server.unref();
  const address = server.address();
  if (address === null || typeof address === "string") { server.close(); throw new Error("无法启动本地授权回调。"); }
  const timer = setTimeout(() => rejectResult(new Error("ChatGPT 授权超时，请重试。")), 300_000);
  timer.unref();
  return {
    redirectUri: `http://127.0.0.1:${address.port}/auth/callback`,
    result,
    close: () => { clearTimeout(timer); server.close(); },
  };
}

export class ChatGptPlanAuth {
  private readonly request: typeof fetch;
  private readonly now: () => number;
  private readonly verify: NonNullable<AuthDependencies["verifyIdentity"]>;
  private readonly refreshes = new Map<string, Promise<string>>();
  private readonly signingOut = new Set<string>();
  private signingIn = false;

  public constructor(private readonly store: ChatGptPlanStore, private readonly dependencies: AuthDependencies) {
    this.request = dependencies.request ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.verify = dependencies.verifyIdentity ?? verifyChatGptIdentity;
  }

  public async signIn(providerId?: string): Promise<{ providerId: string; email: string | null; planEnabled: boolean }> {
    if (this.signingIn) throw new Error("已有 ChatGPT 登录正在进行。");
    if (providerId !== undefined && this.signingOut.has(providerId)) throw new Error("ChatGPT 账号正在断开。");
    this.signingIn = true;
    try { return await this.signInOnce(providerId); } finally { this.signingIn = false; }
  }

  public listConnections(): Array<{ providerId: string; label: string; email: string | null; signedIn: boolean; connected: boolean }> {
    return this.store.list().map((connection) => ({
      providerId: connection.providerId,
      label: connection.label,
      email: connection.email,
      signedIn: connection.accessToken !== null && connection.refreshToken !== null,
      connected: connection.accessToken !== null && connection.refreshToken !== null && hasPlanPermission(connection.scopes),
    }));
  }

  private async signInOnce(providerId?: string): Promise<{ providerId: string; email: string | null; planEnabled: boolean }> {
    const saved = providerId === undefined
      ? this.store.list().find((item) => item.subject === null)
      : this.store.find(providerId);
    if (providerId !== undefined && saved === undefined) throw new Error("ChatGPT 账号不存在，请重新添加。");
    const state = randomValue();
    const nonce = randomValue();
    const verifier = randomValue();
    const callback = await listenForCallback(state, saved?.clientId ?? null);
    try {
      const url = new URL(`${ISSUER}/api/accounts/authorize`);
      const params = new URLSearchParams({
        client_id: saved?.clientId ?? "dynamic_agent_client",
        ext_agent_host_id: this.store.hostId(),
        response_type: "code", redirect_uri: callback.redirectUri, scope: SCOPE, resource: RESOURCE,
        state, nonce, code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      });
      if (saved === undefined) params.set("agent_name_hint", "Aster");
      if (saved?.idToken !== null && saved?.idToken !== undefined) params.set("id_token_hint", saved.idToken);
      if (saved?.email !== null && saved?.email !== undefined) params.set("login_hint", saved.email);
      if (saved?.accessToken !== null && saved?.accessToken !== undefined && !hasPlanPermission(saved.scopes)) {
        params.set("prompt", "consent");
      }
      url.search = params.toString();
      await this.dependencies.openExternal(url.toString());
      const returned = await callback.result;
      const registration: ChatGptConnection = saved ?? {
        providerId: randomUUID(), clientId: returned.clientId, label: `ChatGPT ${this.store.list().length + 1}`, subject: null, email: null,
        idToken: null, accessToken: null, refreshToken: null, expiresAt: 0, scopes: [],
      };
      this.store.save(registration);
      const token = await this.exchange(new URLSearchParams({
        grant_type: "authorization_code", client_id: returned.clientId, code: returned.code,
        code_verifier: verifier, redirect_uri: callback.redirectUri, resource: RESOURCE,
      }));
      if (token.id_token === undefined || token.refresh_token === undefined) throw new Error("ChatGPT 未返回完整授权，请重新登录。");
      const identity = await this.verify(token.id_token, returned.clientId, nonce);
      if (registration.subject !== null && registration.subject !== identity.subject) throw new Error("登录账号与已保存账号不一致。");
      const scopes = (token.scope ?? "").split(/\s+/u).filter(Boolean);
      this.store.save({ ...registration, ...identity, idToken: token.id_token, accessToken: token.access_token,
        refreshToken: token.refresh_token, expiresAt: this.now() + token.expires_in * 1_000, scopes });
      return { providerId: registration.providerId, email: identity.email, planEnabled: hasPlanPermission(scopes) };
    } finally {
      callback.close();
    }
  }

  public async getAccessToken(providerId: string): Promise<string> {
    if (this.signingOut.has(providerId)) throw new Error("ChatGPT 账号正在断开。");
    const connection = this.store.find(providerId);
    if (connection?.accessToken === null || connection?.accessToken === undefined || connection.refreshToken === null) {
      throw new Error("ChatGPT 账号未连接，请重新授权。");
    }
    if (!hasPlanPermission(connection.scopes)) throw new Error("尚未授权使用 ChatGPT 套餐，请在设置中启用。");
    if (connection.expiresAt > this.now() + 60_000) return connection.accessToken;
    const existing = this.refreshes.get(providerId);
    if (existing !== undefined) {
      const token = await existing;
      if (this.signingOut.has(providerId)) throw new Error("ChatGPT 账号正在断开。");
      return token;
    }
    const refresh = this.refresh(connection).finally(() => this.refreshes.delete(providerId));
    this.refreshes.set(providerId, refresh);
    const token = await refresh;
    if (this.signingOut.has(providerId)) throw new Error("ChatGPT 账号正在断开。");
    return token;
  }

  private async refresh(connection: ChatGptConnection): Promise<string> {
    if (connection.refreshToken === null) throw new Error("ChatGPT 授权已失效，请重新登录。");
    let token: z.infer<typeof tokenSchema>;
    try {
      token = await this.exchange(new URLSearchParams({
        grant_type: "refresh_token", client_id: connection.clientId, refresh_token: connection.refreshToken, resource: RESOURCE,
      }));
    } catch (error) {
      if (error instanceof ChatGptOAuthError && error.oauthCode !== null && INVALID_REFRESH_CODES.has(error.oauthCode)) {
        this.store.save({ ...connection, idToken: null, accessToken: null, refreshToken: null, expiresAt: 0, scopes: [] });
        throw new Error("ChatGPT 授权已失效，请重新登录。", { cause: error });
      }
      throw error;
    }
    const scopes = token.scope === undefined ? connection.scopes : token.scope.split(/\s+/u).filter(Boolean);
    if (!hasPlanPermission(scopes)) throw new Error("ChatGPT 套餐授权已失效，请重新登录。");
    this.store.save({ ...connection, accessToken: token.access_token,
      refreshToken: token.refresh_token ?? connection.refreshToken, expiresAt: this.now() + token.expires_in * 1_000, scopes });
    return token.access_token;
  }

  public async listModels(providerId: string): Promise<Array<{ modelId: string; displayName: string }>> {
    const token = await this.getAccessToken(providerId);
    const response = await this.request(`${RESOURCE}/models`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`无法获取 ChatGPT 可用模型（${response.status}）。`);
    const parsed = modelsSchema.parse(await response.json());
    return parsed.models.filter((model) => model.visibility === "list")
      .slice(0, 100).map((model) => ({ modelId: model.slug, displayName: model.display_name }));
  }

  public async signOut(providerId: string): Promise<boolean> {
    if (this.signingIn) throw new Error("ChatGPT 登录正在进行，请稍后断开。");
    if (this.signingOut.has(providerId)) throw new Error("ChatGPT 账号正在断开。");
    this.signingOut.add(providerId);
    try {
      await this.refreshes.get(providerId)?.catch(() => undefined);
      const connection = this.store.find(providerId);
      if (connection === undefined) return true;
      let revoked = connection.refreshToken === null;
      if (connection.refreshToken !== null) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const response = await this.request(`${ISSUER}/api/accounts/oauth/revoke`, {
              method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ token: connection.refreshToken, token_type_hint: "refresh_token", client_id: connection.clientId }),
            });
            revoked = response.ok;
            if (revoked || response.status < 500) break;
          } catch { revoked = false; }
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      this.store.save({ ...connection, idToken: null, accessToken: null, refreshToken: null, expiresAt: 0, scopes: [] });
      return revoked;
    } finally { this.signingOut.delete(providerId); }
  }

  private async exchange(form: URLSearchParams): Promise<z.infer<typeof tokenSchema>> {
    let response: Response;
    try {
      response = await this.request(TOKEN_ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form, redirect: "error", signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error("ChatGPT 授权服务连接失败，请检查网络后重试。"); }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const parsed = z.object({ error: z.union([z.string(), z.object({ code: z.string().optional() })]).optional() }).safeParse(body);
      const oauthError = parsed.success ? parsed.data.error : undefined;
      const code = typeof oauthError === "string" ? oauthError : oauthError?.code ?? null;
      throw new ChatGptOAuthError(code, response.status);
    }
    return tokenSchema.parse(await response.json());
  }
}
