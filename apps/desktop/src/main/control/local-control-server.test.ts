import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LocalControlServer } from "./local-control-server.js";

describe("LocalControlServer", () => {
  let server: LocalControlServer;
  let directory: string;
  let connection: { url: string; token: string };
  const execute = vi.fn(() => Promise.resolve({ ok: true }));
  beforeEach(async () => {
    execute.mockClear();
    directory = await mkdtemp(path.join(os.tmpdir(), "aster-control-"));
    server = new LocalControlServer(execute, vi.fn());
    await server.start(path.join(directory, "connection.json"));
    connection = z.object({ url: z.string(), token: z.string() }).parse(JSON.parse(await readFile(path.join(directory, "connection.json"), "utf8")));
  });
  afterEach(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = (value: unknown, headers: Record<string, string> = {}) => fetch(`${connection.url}/v1/commands`, {
    method: "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json", ...headers }, body: JSON.stringify(value),
  });

  it("publishes a loopback connection and dispatches a validated command", async () => {
    expect(connection.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(connection.token).toHaveLength(64);
    const command = { command: "conversations.list", input: {} };
    expect(await (await request(command)).json()).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledExactlyOnceWith(command);
  });
  it.each([
    { Authorization: "Bearer invalid" },
    { Origin: "https://untrusted.test" },
  ])("rejects unauthenticated or browser requests before dispatch: %j", async (headers) => {
    expect((await request({ command: "conversations.list", input: {} }, headers)).status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects an untrusted Host header before dispatch", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${connection.url}/v1/commands`, { method: "POST", headers: {
        Host: "untrusted.test", Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json",
      } }, (response) => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
      request.on("error", reject);
      request.end(JSON.stringify({ command: "conversations.list", input: {} }));
    });
    expect(status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
  it("protects control startup with authentication, origin and strict input checks", async () => {
    const command = { command: "computer_control.start", input: {} };
    expect((await request(command, { Authorization: "Bearer invalid" })).status).toBe(403);
    expect((await request(command, { Origin: "http://127.0.0.1" })).status).toBe(403);
    expect((await request({ ...command, input: { administrator: true } })).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    expect((await request(command)).status).toBe(200);
    expect(execute).toHaveBeenCalledExactlyOnceWith(command);
  });
  it("rejects malformed JSON, invalid commands and oversized bodies", async () => {
    const headers = { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" };
    expect((await fetch(`${connection.url}/v1/commands`, { method: "POST", headers, body: "{" })).status).toBe(400);
    expect((await request({ command: "messages.send", input: {} })).status).toBe(400);
    expect((await request({ large: "x".repeat(1_048_577) })).status).toBe(413);
    expect(execute).not.toHaveBeenCalled();
  });
  it("streams the same validated runtime events and cleans up subscribers and connection file", async () => {
    const response = await fetch(`${connection.url}/v1/events`, { headers: { Authorization: `Bearer ${connection.token}` } });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
    const event = { type: "run.started" as const, conversationId: "00000000-0000-4000-8000-000000000001", runId: "00000000-0000-4000-8000-000000000002", modelId: "fake" };
    server.publish(event);
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(chunk.split("\n").find((line) => line.startsWith("data: "))!.slice(6))).toEqual(event);
    expect(() => server.publish({ ...event, modelId: "" })).toThrow();
    await server.close();
    expect((await reader.read()).done).toBe(true);
    await expect(readFile(path.join(directory, "connection.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("returns safe errors without internal causes and does not automatically retry commands", async () => {
    execute.mockRejectedValueOnce(new Error("secret internal detail"));
    const response = await request({ command: "conversations.list", input: {} });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret internal detail");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("keeps a reading subscriber connected when a single valid event exceeds the socket high-water mark", async () => {
    const response = await fetch(`${connection.url}/v1/events`, { headers: { Authorization: `Bearer ${connection.token}` } });
    const reader = response.body!.getReader();
    await reader.read();
    const event = { type: "assistant.delta", conversationId: "00000000-0000-4000-8000-000000000001",
      runId: "00000000-0000-4000-8000-000000000002", messageId: "00000000-0000-4000-8000-000000000003", modelId: "fixture", delta: "large output ".repeat(10_000) };
    server.publish(event);
    let frame = "";
    while (!frame.includes("\n\n")) {
      const chunk = await reader.read(); expect(chunk.done).toBe(false);
      frame += new TextDecoder().decode(chunk.value);
    }
    expect(JSON.parse(frame.split("\n").find(line => line.startsWith("data: "))!.slice(6))).toEqual(event);
    await server.close(); await reader.cancel();
  });
});
