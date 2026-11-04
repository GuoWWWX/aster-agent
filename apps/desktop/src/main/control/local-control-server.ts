import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { conversationRunEventSchema, localControlCommandSchema, type LocalControlCommand } from "@agent/protocol";
import { toMainAgentError } from "../errors/agent-error.js";

const MAX_REQUEST_BYTES = 1_048_576;
const MAX_STREAM_BUFFER_BYTES = 2_097_152;

/** Opt-in loopback transport. The token is never sent to the Renderer or logs. */
export class LocalControlServer {
  private readonly server: Server;
  private readonly token = randomBytes(32).toString("hex");
  private readonly instanceId = randomUUID();
  private readonly streams = new Set<ServerResponse>();
  private connectionPath: string | undefined;
  private host = "";
  private sequence = 0;

  public constructor(private readonly execute: (command: LocalControlCommand) => Promise<unknown>,
    private readonly reportError: (error: unknown) => void) {
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        this.reportError(error);
        if (response.headersSent) { response.destroy(); return; }
        const safe = toMainAgentError(error, { operation: "local_control.command", redactValues: [this.token] });
        this.json(response, 500, { error: { code: safe.code, message: safe.message, retryable: safe.retryable, instanceId: safe.id } });
      });
    });
    this.server.requestTimeout = 15_000;
  }

  public async start(connectionPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => { this.server.removeListener("error", reject); resolve(); });
    });
    const address = this.server.address();
    if (address === null || typeof address === "string") throw new Error("Local control address unavailable.");
    this.host = `127.0.0.1:${address.port}`;
    try {
      await mkdir(path.dirname(connectionPath), { recursive: true });
      await writeFile(connectionPath, JSON.stringify({ schemaVersion: 1, url: `http://${this.host}`, token: this.token, pid: process.pid }), { mode: 0o600 });
      this.connectionPath = connectionPath;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  public publish(event: unknown): void {
    const validated = conversationRunEventSchema.parse(event);
    const data = `id: ${this.instanceId}:${++this.sequence}\nevent: conversation\ndata: ${JSON.stringify(validated)}\n\n`;
    for (const stream of this.streams) {
      // write(false) also occurs for one large event on a healthy connection.
      // Bound queued bytes without blocking Agent execution while the socket drains.
      if (stream.writableLength + Buffer.byteLength(data) > MAX_STREAM_BUFFER_BYTES) stream.destroy();
      else stream.write(data);
    }
  }

  public async close(): Promise<void> {
    for (const stream of this.streams) stream.end();
    this.streams.clear();
    await new Promise<void>((resolve, reject) => {
      if (!this.server.listening) { resolve(); return; }
      this.server.close((error) => error === undefined ? resolve() : reject(error));
      this.server.closeAllConnections();
    });
    if (this.connectionPath !== undefined) {
      await rm(this.connectionPath, { force: true });
      this.connectionPath = undefined;
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authorization = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${this.token}`);
    if (request.headers.origin !== undefined || request.headers.host !== this.host
      || authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      this.json(response, 403, { error: { code: "PERMISSION_DENIED", message: "Local control authentication required." } });
      return;
    }
    if (request.method === "GET" && request.url === "/v1/events") {
      if (this.streams.size >= 16) { this.json(response, 503, { error: { code: "CONFLICT", message: "Too many subscribers." } }); return; }
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      this.streams.add(response);
      response.write(`event: ready\ndata: ${JSON.stringify({ instanceId: this.instanceId, snapshotRequired: true })}\n\n`);
      const heartbeat = setInterval(() => { if (!response.write(": heartbeat\n\n")) response.destroy(); }, 15_000);
      heartbeat.unref();
      response.once("close", () => { clearInterval(heartbeat); this.streams.delete(response); });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/commands") {
      this.json(response, 404, { error: { code: "ARTIFACT_NOT_FOUND", message: "Unknown endpoint." } }); return;
    }
    if (request.headers["content-type"] !== "application/json") {
      this.json(response, 415, { error: { code: "VALIDATION_FAILED", message: "Expected application/json." } }); return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const rawChunk of request) {
      const chunk: unknown = rawChunk;
      if (!(chunk instanceof Uint8Array)) throw new Error("Invalid request body chunk.");
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes <= MAX_REQUEST_BYTES) chunks.push(buffer);
    }
    if (bytes > MAX_REQUEST_BYTES) { this.json(response, 413, { error: { code: "VALIDATION_FAILED", message: "Request too large." } }); return; }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { this.json(response, 400, { error: { code: "VALIDATION_FAILED", message: "Invalid JSON." } }); return; }
    const parsed = localControlCommandSchema.safeParse(input);
    if (!parsed.success) { this.json(response, 400, { error: { code: "VALIDATION_FAILED", message: "Invalid command input." } }); return; }
    this.json(response, 200, await this.execute(parsed.data));
  }

  private json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(value));
  }
}
