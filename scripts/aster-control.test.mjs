import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ReadableStream } from "node:stream/web";
import { TextEncoder } from "node:util";
import { controlEvents, runControl } from "./aster-control.mjs";

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-cli-"));
  try {
    const connection = path.join(directory, "connection.json");
    await writeFile(connection, JSON.stringify({ schemaVersion: 1, url: "http://127.0.0.1:1234", token: "a".repeat(64) }));
    await run(connection);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("CLI waits with a subscription established before send and matches only the accepted Run", async () => fixture(async (connection) => {
  const calls = [];
  const output = [];
  const fetchControl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("events")) return new Response('event: ready\ndata: {}\n\nevent: conversation\ndata: {"type":"run.finished","conversationId":"c","runId":"other","status":"failed"}\n\nevent: conversation\ndata: {"type":"run.finished","conversationId":"c","runId":"r","status":"completed"}\n\n');
    return new Response(JSON.stringify({ kind: "started", runId: "r" }));
  };
  assert.equal(await runControl(["--connection", connection, "send", '{"conversationId":"c","content":"hello"}', "--wait"], { fetchControl, out: (value) => output.push(value) }), 0);
  assert.ok(calls[0].url.endsWith("events"));
  assert.deepEqual(JSON.parse(calls[1].options.body), { command: "messages.send", input: { conversationId: "c", content: "hello" } });
  assert.equal(output.at(-1).runId, "r");
}));

test("CLI tracks a queued message when it is consumed and reports failed Runs", async () => fixture(async (connection) => {
  const fetchControl = async (url) => url.endsWith("events")
    ? new Response('event: ready\ndata: {}\n\nevent: conversation\ndata: {"type":"pending_messages.updated","conversationId":"c","consumedMessages":[{"id":"p","runId":"r"}]}\n\nevent: conversation\ndata: {"type":"run.finished","conversationId":"c","runId":"r","status":"failed"}\n\n')
    : new Response('{"kind":"pending","pendingMessage":{"id":"p"}}');
  assert.equal(await runControl(["--connection", connection, "send", '{"conversationId":"c","content":"hello"}', "--wait"], { fetchControl, out: () => {} }), 1);
}));

test("SSE parser preserves split UTF-8 and ignores heartbeat frames", async () => {
  const bytes = new TextEncoder().encode(': heartbeat\n\nevent: conversation\ndata: {"delta":"你好"}\n\n');
  const stream = new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } });
  const events = [];
  for await (const event of controlEvents(new Response(stream))) events.push(event);
  assert.deepEqual(events, [{ type: "conversation", data: { delta: "你好" } }]);
});

test("CLI rejects invalid commands and safe errors never include the connection token", async () => fixture(async (connection) => {
  await assert.rejects(runControl(["--connection", connection, "unknown"]), /Usage/);
  await assert.rejects(runControl(["--connection", connection, "list"], { fetchControl: async () =>
    new Response('{"error":{"code":"CONFLICT","message":"retry"}}', { status: 500 }) }), /CONFLICT: retry/);
  await writeFile(connection, JSON.stringify({ schemaVersion: 1, url: "https://remote.test", token: "secret" }));
  await assert.rejects(runControl(["--connection", connection, "list"]), /Invalid local control/);
}));
