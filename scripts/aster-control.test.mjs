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

test("CLI exposes model status, question answers, approvals and scoped program controls", async () => fixture(async (connection) => {
  const mapping = { models: "models.status", questions: "user_questions.list", answer: "user_questions.answer", approve: "approvals.resolve", programs: "background_commands.list", "stop-program": "background_commands.stop", permission: "conversations.set_permission", rename: "conversations.rename", archive: "conversations.archive" };
  for (const [name, command] of Object.entries(mapping)) {
    let actual;
    assert.equal(await runControl(["--connection", connection, name, '{"fixture":true}'], { fetchControl: async (_url, options) => { actual = JSON.parse(options.body); return new Response("{}"); }, out: () => {} }), 0);
    assert.deepEqual(actual, { command, input: { fixture: true } });
  }
}));

test("CLI verify opens the desktop conversation before both Runs, then checks saved history", async () => fixture(async (connection) => {
  const calls = [];
  const output = [];
  const messages = [];
  const frame = (data) => `event: conversation\ndata: ${JSON.stringify(data)}\n\n`;
  const stream = 'event: ready\ndata: {}\n\n'
    + frame({ type: "conversation.updated", conversation: { id: "other" } })
    + frame({ type: "conversation.updated", conversation: { id: "c" } })
    + [1, 2].map((round) => frame({ type: "run.started", conversationId: "c", runId: `r${round}` })
      + frame({ type: "assistant.delta", conversationId: "c", runId: `r${round}`, delta: `answer ${round}` })
      + frame({ type: "run.finished", conversationId: "c", runId: `r${round}`, status: "completed" })).join("");
  const fetchControl = async (url, options) => {
    calls.push(url.endsWith("events") ? "subscribe" : JSON.parse(options.body).command);
    if (url.endsWith("events")) return new Response(stream);
    const request = JSON.parse(options.body);
    if (request.command === "conversations.create") {
      assert.deepEqual(request.input, { projectId: "project" });
      return new Response('{"id":"c"}');
    }
    if (request.command === "messages.send") {
      assert.equal(request.input.conversationId, "c");
      messages.push({ kind: "message", role: "user", content: request.input.content },
        { kind: "message", role: "assistant", content: `answer ${messages.length / 2 + 1}` });
      return new Response(JSON.stringify({ kind: "started", runId: `r${messages.length / 2}` }));
    }
    return new Response(JSON.stringify({ items: messages }));
  };
  assert.equal(await runControl(["--connection", connection, "verify", '{"projectId":"project"}', "--open"], { fetchControl, out: (value) => output.push(value) }), 0);
  assert.deepEqual(calls, ["subscribe", "conversations.create", "conversations.open", "messages.send", "messages.send", "conversations.read"]);
  assert.deepEqual(output.at(-1), { type: "verification.finished", ok: true, conversationId: "c", runIds: ["r1", "r2"], rounds: 2, userMessages: 2, assistantMessages: 2 });
}));

test("CLI verify stops at a failed Run and does not submit another message", async () => fixture(async (connection) => {
  const calls = [];
  const output = [];
  const fetchControl = async (url, options) => {
    if (url.endsWith("events")) return new Response('event: ready\ndata: {}\n\nevent: conversation\ndata: {"type":"conversation.updated","conversation":{"id":"c"}}\n\nevent: conversation\ndata: {"type":"run.finished","conversationId":"c","runId":"r","status":"failed"}\n\n');
    const command = JSON.parse(options.body).command;
    calls.push(command);
    return new Response(JSON.stringify(command === "conversations.create" ? { id: "c" } : { kind: "started", runId: "r" }));
  };
  assert.equal(await runControl(["--connection", connection, "verify"], { fetchControl, out: (value) => output.push(value) }), 1);
  assert.deepEqual(calls, ["conversations.create", "messages.send"]);
  assert.deepEqual(output.at(-1), { type: "verification.finished", ok: false, conversationId: "c", runIds: ["r"], failedRound: 1, status: "failed" });
}));

test("CLI verify rejects missing persisted history even when both streamed Runs complete", async () => fixture(async (connection) => {
  let round = 0;
  const frame = (data) => `event: conversation\ndata: ${JSON.stringify(data)}\n\n`;
  const stream = 'event: ready\ndata: {}\n\n' + frame({ type: "conversation.updated", conversation: { id: "c" } })
    + [1, 2].map((index) => frame({ type: "run.started", conversationId: "c", runId: `r${index}` })
      + frame({ type: "assistant.delta", conversationId: "c", runId: `r${index}`, delta: "answer" })
      + frame({ type: "run.finished", conversationId: "c", runId: `r${index}`, status: "completed" })).join("");
  const fetchControl = async (url, options) => {
    if (url.endsWith("events")) return new Response(stream);
    const { command } = JSON.parse(options.body);
    if (command === "conversations.create") return new Response('{"id":"c"}');
    if (command === "messages.send") return new Response(JSON.stringify({ kind: "started", runId: `r${++round}` }));
    return new Response('{"items":[]}');
  };
  await assert.rejects(runControl(["--connection", connection, "verify"], { fetchControl, out: () => {} }), /Saved history/);
}));
