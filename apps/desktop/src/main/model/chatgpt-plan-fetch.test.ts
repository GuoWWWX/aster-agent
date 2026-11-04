import { describe, expect, it, vi } from "vitest";
import { createChatGptPlanFetch } from "./chatgpt-plan-fetch.js";

describe("ChatGPT plan Responses transport", () => {
  it("uses the current OAuth token and adapts the Responses request without changing its tools", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('data: {"type":"response.completed"}\n\n'));
    const accessToken = vi.fn().mockResolvedValue("private-token");
    const send = createChatGptPlanFetch(accessToken, request);
    const tools = [{ type: "function", name: "read_file", parameters: { type: "object" }, strict: false }];

    await send("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer placeholder", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "example-model",
        input: [{ type: "message", role: "system", content: "Instructions" }, { role: "user", content: "Hello" }],
        tools,
        store: true,
        stream: false,
        max_output_tokens: 512,
        previous_response_id: "old-response",
        temperature: 0.5,
      }),
    });

    expect(accessToken).toHaveBeenCalledOnce();
    const init = request.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-token");
    expect(init?.redirect).toBe("error");
    if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
    const body: unknown = JSON.parse(init.body);
    expect(body).toEqual({
      model: "example-model",
      input: [
        { type: "additional_tools", role: "developer", tools },
        { type: "message", role: "developer", content: "Instructions" },
        { role: "user", content: "Hello" },
      ],
      store: false,
      stream: true,
    });
  });

  it("never obtains or sends credentials to an untrusted destination", async () => {
    const request = vi.fn<typeof fetch>();
    const accessToken = vi.fn().mockResolvedValue("private-token");
    const send = createChatGptPlanFetch(accessToken, request);
    await expect(send("https://example.test/v1/responses", { method: "POST", body: "{}" })).rejects.toThrow();
    expect(accessToken).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("reports a usage-limit failure delivered after the stream opens", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      'data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n',
    ));
    const send = createChatGptPlanFetch(() => Promise.resolve("private-token"), request);
    const response = await send("https://api.openai.com/v1/responses", {
      method: "POST", body: JSON.stringify({ input: [{ role: "user", content: "Hi" }] }),
    });
    const result = response.text();
    await expect(result).rejects.toHaveProperty("status", 429);
    await expect(result).rejects.toThrow(/管理用量/u);
  });
});
