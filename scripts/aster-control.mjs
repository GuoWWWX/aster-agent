import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

const commands = { projects: "projects.list", list: "conversations.list", create: "conversations.create",
  read: "conversations.read", send: "messages.send", cancel: "runs.cancel" };

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

export async function runControl(argv, { out = (value) => console.log(JSON.stringify(value)), fetchControl = fetch } = {}) {
  const args = [...argv];
  const connectionIndex = args.indexOf("--connection");
  const connectionPath = connectionIndex < 0 ? process.env.ASTER_CONTROL_FILE : args.splice(connectionIndex, 2)[1];
  const waitIndex = args.indexOf("--wait");
  const wait = waitIndex >= 0;
  if (wait) args.splice(waitIndex, 1);
  const [name, json = "{}"] = args;
  if (!connectionPath || (name !== "watch" && commands[name] === undefined) || args.length > 2 || (wait && name !== "send")) {
    throw new Error('Usage: pnpm control --connection <local-control.json> projects|list|create|read|send|cancel|watch [JSON] [--wait]');
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
  try {
    if (wait || name === "watch") {
      events = controlEvents(await fetchControl(`${connection.url}/v1/events`, { headers, signal: abort.signal }));
      const ready = await events.next();
      if (ready.value?.type !== "ready") throw new Error("Event stream did not initialize.");
      if (name === "watch") {
        out(ready.value);
        for await (const event of events) out(event);
        return 0;
      }
      timer = setTimeout(() => abort.abort(new Error("Timed out waiting for Run; use read or watch to inspect it.")), 120_000);
    }
    const response = await fetchControl(`${connection.url}/v1/commands`, {
      method: "POST", headers, body: JSON.stringify({ command: commands[name], input }), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`${result.error?.code ?? response.status}: ${result.error?.message ?? "Command failed."}`);
    out(result);
    if (!events) return 0;
    let runId = result.kind === "started" ? result.runId : undefined;
    for await (const { data } of events) {
      if (data.conversationId !== input.conversationId) continue;
      if (result.kind === "pending" && data.type === "pending_messages.updated") {
        runId = data.consumedMessages?.find((message) => message.id === result.pendingMessage.id)?.runId ?? runId;
      }
      out(data);
      if (data.type === "run.finished" && data.runId === runId) return data.status === "completed" ? 0 : 1;
    }
    throw new Error("Event stream closed before Run finished; use read to recover the latest result.");
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
