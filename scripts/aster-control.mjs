import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

const commands = { projects: "projects.list", list: "conversations.list", create: "conversations.create",
  read: "conversations.read", send: "messages.send", cancel: "runs.cancel", open: "conversations.open", "configure-model": "models.configure" };

export async function* controlEvents(response) {
  if (!response.ok || response.body === null) throw new Error(`Event subscription failed (${response.status}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const type = frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
        const data = frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
        if (data) yield { type, data: JSON.parse(data) };
      }
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
}

async function waitForRun(events, conversationId, submission, out) {
  let runId = submission.kind === "started" ? submission.runId : undefined;
  for (let frame = await events.next(); !frame.done; frame = await events.next()) {
    const { data } = frame.value;
    if (data.conversationId !== conversationId) continue;
    if (submission.kind === "pending" && data.type === "pending_messages.updated") {
      runId = data.consumedMessages?.find((message) => message.id === submission.pendingMessage.id)?.runId ?? runId;
    }
    out(data);
    if (data.type === "run.finished" && data.runId === runId) return { runId, status: data.status };
  }
  throw new Error("Event stream closed before Run finished; use read to recover the latest result.");
}

async function verifyConversation(request, events, input, out, open) {
  const conversation = await request("conversations.create", input);
  if (typeof conversation.id !== "string") throw new Error("Creation did not return a conversation ID.");
  const conversationId = conversation.id;
  out({ type: "verification.created", conversationId });
  let creationObserved = false;
  for (let frame = await events.next(); !frame.done; frame = await events.next()) {
    const { data } = frame.value;
    if (data.type === "conversation.updated" && data.conversation?.id === conversationId) {
      creationObserved = true;
      break;
    }
  }
  if (!creationObserved) throw new Error("Created conversation was not broadcast to observers.");
  if (open) await request("conversations.open", { conversationId });
  const prompts = [
    "这是一条后台接口验收消息。请仅回复 ASTER_CONTROL_ROUND_1，不调用任何工具。",
    "这是同一对话的第二轮验收。请仅回复 ASTER_CONTROL_ROUND_2，不调用任何工具。",
  ];
  const runIds = [];
  for (const [index, content] of prompts.entries()) {
    const submission = await request("messages.send", { conversationId, content, deliveryMode: "queue" });
    const observed = new Set();
    const finished = await waitForRun(events, conversationId, submission, (event) => {
      observed.add(event.type);
      out(event);
    });
    runIds.push(finished.runId);
    if (finished.status !== "completed") {
      out({ type: "verification.finished", ok: false, conversationId, runIds, failedRound: index + 1, status: finished.status });
      return 1;
    }
    if (!observed.has("run.started") || !observed.has("assistant.delta")) {
      throw new Error("Run completed without its start and streaming response being observed.");
    }
  }
  const history = await request("conversations.read", { conversationId });
  const messages = history.items?.filter((item) => item.kind === "message") ?? [];
  const userMessages = messages.filter((item) => item.role === "user");
  const assistantMessages = messages.filter((item) => item.role === "assistant" && item.content?.trim());
  if (userMessages.length !== 2 || assistantMessages.length !== 2
    || !prompts.every((content, index) => userMessages[index]?.content === content)) {
    throw new Error("Saved history does not contain both submitted messages and completed responses; use read to inspect it.");
  }
  out({ type: "verification.finished", ok: true, conversationId, runIds, rounds: 2,
    userMessages: userMessages.length, assistantMessages: assistantMessages.length });
  return 0;
}

export async function runControl(argv, { out = (value) => console.log(JSON.stringify(value)), fetchControl = fetch } = {}) {
  const args = [...argv];
  const connectionIndex = args.indexOf("--connection");
  const connectionPath = connectionIndex < 0 ? process.env.ASTER_CONTROL_FILE : args.splice(connectionIndex, 2)[1];
  const waitIndex = args.indexOf("--wait");
  const wait = waitIndex >= 0;
  if (wait) args.splice(waitIndex, 1);
  const openIndex = args.indexOf("--open");
  const open = openIndex >= 0;
  if (open) args.splice(openIndex, 1);
  const [name, json = "{}"] = args;
  if (!connectionPath || (name !== "watch" && name !== "verify" && commands[name] === undefined) || args.length > 2 || (wait && name !== "send") || (open && name !== "verify")) {
    throw new Error('Usage: pnpm control --connection <local-control.json> projects|list|create|read|send|cancel|open|configure-model|watch|verify [JSON] [--wait] [--open]');
  }
  const connection = JSON.parse(await readFile(connectionPath, "utf8"));
  const url = new URL(connection.url);
  if (connection.schemaVersion !== 1 || url.protocol !== "http:" || url.hostname !== "127.0.0.1"
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash || !/^[a-f0-9]{64}$/.test(connection.token)) {
    throw new Error("Invalid local control connection file.");
  }
  const input = JSON.parse(json.startsWith("@") ? await readFile(json.slice(1), "utf8") : json);
  const headers = { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" };
  const abort = new AbortController();
  let timer;
  let events;
  const request = async (command, commandInput) => {
    const response = await fetchControl(`${connection.url}/v1/commands`, {
      method: "POST", headers, body: JSON.stringify({ command, input: commandInput }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`${result.error?.code ?? response.status}: ${result.error?.message ?? "Command failed."}`);
    return result;
  };
  try {
    if (wait || name === "verify") {
      timer = setTimeout(() => abort.abort(new Error("Timed out waiting for Run; use read or watch to inspect it.")), 120_000);
    }
    if (wait || name === "watch" || name === "verify") {
      events = controlEvents(await fetchControl(`${connection.url}/v1/events`, { headers, signal: abort.signal }));
      const ready = await events.next();
      if (ready.value?.type !== "ready") throw new Error("Event stream did not initialize.");
      if (name === "watch") {
        out(ready.value);
        for await (const event of events) out(event);
        return 0;
      }
    }
    if (name === "verify") return await verifyConversation(request, events, input, out, open);
    const result = await request(commands[name], input);
    out(result);
    if (!events) return 0;
    const finished = await waitForRun(events, input.conversationId, result, out);
    return finished.status === "completed" ? 0 : 1;
  } finally {
    clearTimeout(timer);
    try { await events?.return(); } finally { abort.abort(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runControl(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
