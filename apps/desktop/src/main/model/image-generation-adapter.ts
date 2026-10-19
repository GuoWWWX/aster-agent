import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import type { ModelConfiguration } from "./model-contracts.js";

const MAX_RESPONSE_BYTES = 100 * 1024 * 1024;
const responseSchema = z.object({ data: z.array(z.object({ b64_json: z.string().min(1).max(36_000_000) })).min(1).max(10) });
export type GeneratedImage = { data: string; mimeType: string };
export type ImageGenerationRequest = {
  prompt: string; count: number; size?: string | undefined;
  referenceImages: Array<GeneratedImage & { name: string }>;
};

export class ImageGenerationError extends Error {}

async function readResponse(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new ImageGenerationError("生图响应过大，请减少生成数量。"); }
  const reader = response.body?.getReader();
  if (reader === undefined) throw new ImageGenerationError("生图服务返回了空响应。");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new ImageGenerationError("生图响应过大，请减少生成数量。"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

/** Images API is independent of the provider's configured chat protocol. Never replay paid requests. */
export class ImageGenerationAdapter {
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async generate(configuration: ModelConfiguration, input: ImageGenerationRequest, signal: AbortSignal): Promise<GeneratedImage[]> {
    signal.throwIfAborted();
    if (!["openai-responses", "openai-chat-completions"].includes(configuration.apiFormat)) {
      throw new ImageGenerationError("此供应商尚未配置兼容的 Images API，请选择 OpenAI 兼容供应商的生图模型。");
    }
    const operation = input.referenceImages.length === 0 ? "generations" : "edits";
    const headers: Record<string, string> = { Authorization: `Bearer ${configuration.apiKey}` };
    let body: string | FormData;
    if (operation === "generations") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({ model: configuration.modelId, prompt: input.prompt, n: input.count,
        ...(input.size === undefined ? {} : { size: input.size }),
        ...(/^dall-e-/iu.test(configuration.modelId) ? { response_format: "b64_json" } : {}) });
    } else {
      const form = new FormData();
      form.set("model", configuration.modelId); form.set("prompt", input.prompt); form.set("n", String(input.count));
      if (input.size !== undefined) form.set("size", input.size);
      for (const image of input.referenceImages) {
        form.append("image[]", new Blob([Buffer.from(image.data, "base64")], { type: image.mimeType }), image.name);
      }
      body = form;
    }
    const response = await this.fetcher(`${configuration.baseUrl.replace(/\/+$/u, "")}/images/${operation}`, {
      method: "POST", headers, body, signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]), redirect: "error",
    });
    if (!response.ok) {
      let reason = "";
      try {
        const body: unknown = JSON.parse(await readResponse(response, 8192));
        const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
        if (parsed.success) reason = parsed.data.error.message.replaceAll(configuration.apiKey, "[redacted]").slice(0,500);
      } catch { /* A bounded, non-JSON error body is not exposed. HTTP status remains actionable. */ }
      throw new ImageGenerationError(`生图请求失败（HTTP ${response.status}）${reason ? `：${reason}` : ""}。未自动重试，以免重复生成。`);
    }
    const text = await readResponse(response, MAX_RESPONSE_BYTES);
    signal.throwIfAborted();
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new ImageGenerationError("生图服务返回了无效响应。"); }
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) throw new ImageGenerationError("生图服务未返回可用的 Base64 图片，请检查模型及接口格式。");
    const payload = parsed.data;
    if (payload.data.length > input.count) throw new ImageGenerationError("供应商返回的图片数量超出本次请求。");
    return Promise.all(payload.data.map(async image => {
      if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(image.b64_json)) throw new ImageGenerationError("供应商返回的图片编码无效。");
      const bytes = Buffer.from(image.b64_json, "base64");
      if (bytes.length > 25 * 1024 * 1024) throw new ImageGenerationError("单张生成图片超过 25 MB。");
      const type = await fileTypeFromBuffer(bytes);
      if (type === undefined || !["image/png", "image/jpeg", "image/webp"].includes(type.mime)) throw new ImageGenerationError("供应商没有返回有效的 PNG、JPEG 或 WebP 图片。");
      return { data: bytes.toString("base64"), mimeType: type.mime };
    }));
  }
}
