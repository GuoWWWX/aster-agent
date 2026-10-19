import { describe, expect, it, vi } from "vitest";
import { ImageGenerationAdapter } from "./image-generation-adapter.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMfoAAAAASUVORK5CYII=";
const configuration = { apiKey: "private-key", baseUrl: "https://provider.test/v1", apiFormat: "openai-responses" as const, modelId: "gpt-image-2.5-flare", reasoningOptions: [] };

describe("ImageGenerationAdapter", () => {
  it("requests several variants in one text-to-image request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ b64_json: png }, { b64_json: png }] }));
    const images = await new ImageGenerationAdapter(fetcher).generate(configuration, { prompt: "two variants", count: 2, referenceImages: [] }, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://provider.test/v1/images/generations");
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON request");
    expect(JSON.parse(body)).toMatchObject({ model: configuration.modelId, n: 2, prompt: "two variants" });
    expect(images).toHaveLength(2);
    expect(images[0]?.mimeType).toBe("image/png");
  });

  it("sends all references as multipart images in one edit request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ b64_json: png }] }));
    await new ImageGenerationAdapter(fetcher).generate(configuration, { prompt: "combine", count: 1, referenceImages: [1,2].map(n => ({ data: png, mimeType: "image/png", name: `ref${n}.png` })) }, new AbortController().signal);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://provider.test/v1/images/edits");
    const form = fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(form.getAll("image[]")).toHaveLength(2);
    expect(form.get("n")).toBe("1");
  });

  it("does not retry provider failures or leak request credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-key", { status: 502 }));
    await expect(new ImageGenerationAdapter(fetcher).generate(configuration, { prompt: "test", count: 1, referenceImages: [] }, new AbortController().signal)).rejects.toThrow("HTTP 502");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves a provider permission failure and redacts secrets in its message", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "Image generation is not enabled for this group private-key" } }, { status: 403 }));
    await expect(new ImageGenerationAdapter(fetcher).generate(configuration, { prompt: "test", count: 1, referenceImages: [] }, new AbortController().signal))
      .rejects.toThrow("Image generation is not enabled for this group [redacted]");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not send cancelled work and rejects invalid image responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ b64_json: "not-an-image" }] }));
    const controller = new AbortController(); controller.abort();
    await expect(new ImageGenerationAdapter(fetcher).generate(configuration, { prompt: "test", count: 1, referenceImages: [] }, controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(new ImageGenerationAdapter(fetcher).generate(configuration, { prompt: "test", count: 1, referenceImages: [] }, new AbortController().signal)).rejects.toThrow();
  });
});
