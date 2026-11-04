import { z } from "zod";
import { ModelRequestError, ModelResponseError } from "./model-request-error.js";

const requestSchema = z.object({
  input: z.array(z.unknown()),
  tools: z.array(z.object({ type: z.enum(["function", "custom"]) }).passthrough()).optional(),
}).passthrough();

const unsupported = [
  "background", "conversation", "max_output_tokens", "max_tool_calls", "metadata", "moderation",
  "multi_agent", "prompt", "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs",
  "top_p", "truncation", "user", "previous_response_id",
] as const;

function requestBody(body: BodyInit | null | undefined): string {
  if (typeof body !== "string") throw new Error("ChatGPT 套餐请求格式无效。");
  const parsed: unknown = JSON.parse(body);
  const payload = requestSchema.parse(parsed);
  const { tools, ...rest } = payload;
  for (const key of unsupported) delete rest[key];
  const input = rest.input.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    const entry = item as Record<string, unknown>;
    return entry.role === "system" ? { ...entry, role: "developer" } : item;
  });
  return JSON.stringify({
    ...rest,
    input: tools === undefined || tools.length === 0
      ? input
      : [{ type: "additional_tools", role: "developer", tools }, ...input],
    store: false,
    stream: true,
  });
}

function requireCompletedResponse(response: Response): Response {
  if (response.body === null) throw new ModelResponseError("ChatGPT 响应为空，请重试。");
  const decoder = new TextDecoder();
  let pending = "";
  let completed = false;
  function inspect(line: string): void {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      if (!completed) throw new ModelResponseError("ChatGPT 响应未完成，请重试。");
      return;
    }
    let raw: unknown;
    try { raw = JSON.parse(data); } catch {
      // The SDK reports malformed events; absence of a completed event is checked below.
      return;
    }
    const event = z.object({ type: z.string() }).passthrough().safeParse(raw);
    if (!event.success) return;
    if (event.data.type === "response.completed") completed = true;
    if (event.data.type === "response.incomplete") throw new ModelResponseError("ChatGPT 响应不完整，请重试。");
    if (event.data.type !== "response.failed") return;
    const failure = z.object({ response: z.object({ error: z.object({
      code: z.string().max(100).regex(/^[a-z0-9_]+$/u).nullish(),
    }).nullish() }).nullish() }).safeParse(raw);
    const code = failure.success ? failure.data.response?.error?.code : null;
    if (code === "subscription_sharing_usage_limit_exceeded") {
      throw new ModelRequestError(429, `ChatGPT 套餐用量达到限制（${code}），请通过“管理用量”查看。`, false);
    }
    if (code === "subscription_sharing_usage_unavailable") {
      throw new ModelRequestError(503, `暂时无法检查 ChatGPT 套餐用量（${code}），请稍后重试。`);
    }
    throw new ModelResponseError(`ChatGPT 响应失败${code ? `（${code}）` : ""}，请重试。`);
  }
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) inspect(line);
      controller.enqueue(chunk);
    },
    flush() {
      pending += decoder.decode();
      if (pending.length > 0) inspect(pending);
      if (!completed) throw new ModelResponseError("ChatGPT 响应未完成，请重试。");
    },
  }));
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(body, { headers, status: response.status, statusText: response.statusText });
}

/** Adapt only official ChatGPT plan requests; credentials never leave the OpenAI origin. */
export function createChatGptPlanFetch(accessToken: () => Promise<string>, request: typeof fetch): typeof fetch {
  return async (requestInfo, init) => {
    const url = new URL(requestInfo instanceof Request ? requestInfo.url : requestInfo.toString());
    if (url.toString() !== "https://api.openai.com/v1/responses" || init?.method?.toUpperCase() !== "POST") {
      throw new Error("ChatGPT 套餐只能用于官方 Responses API。");
    }
    const body = requestBody(init.body);
    const token = await accessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    let response: Response;
    try {
      response = await request(url, { ...init, body, headers, redirect: "error" });
    } catch {
      init.signal?.throwIfAborted();
      throw new Error("ChatGPT 模型请求失败，请检查网络连接。");
    }
    if (response.ok) return requireCompletedResponse(response);
    const detail = (await response.text()).replaceAll(token, "[redacted]");
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-encoding");
    return new Response(detail, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  };
}
