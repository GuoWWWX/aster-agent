import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { controlEvents } from "./aster-control.mjs";

// Explicit manual acceptance against a running desktop, using its configured model.
export async function desktopScenarios({ connectionPath, providerId, modelId = "gpt-6-luna", only, restartFile, conversationId, from, logPath }) {
  const events = [];
  const waiters = new Set();
  let sharedId = conversationId;
  let phaseOffset = 0;
  let phaseItemIds = new Set();
  let currentCase = "";
  let reachedStart = from === undefined;
  let logOffset = logPath === undefined ? 0 : (await readFile(logPath, "utf8")).length;
  const abort = new AbortController();
  const connection = JSON.parse(await readFile(connectionPath, "utf8"));
  const url = new URL(connection.url);
  assert.equal(connection.schemaVersion, 1);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.origin + "/", url.href);
  assert.match(connection.token, /^[a-f0-9]{64}$/);
  const headers = { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" };
  const request = async (command, input = {}, expected = 200) => {
    const response = await fetch(`${connection.url}/v1/commands`, { method: "POST", headers,
      body: JSON.stringify({ command, input }), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    assert.equal(response.status, expected, `${command}: ${result.error?.code ?? response.status}`);
    return result;
  };
  const wait = (predicate, timeoutMs = 90000) => {
    const existing = events.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const listener = (event) => { if (predicate(event)) { clearTimeout(timer); waiters.delete(listener); resolve(event); } };
      const timer = setTimeout(() => { waiters.delete(listener); reject(new Error("Expected desktop event did not arrive.")); }, timeoutMs);
      waiters.add(listener);
    });
  };
  const stream = controlEvents(await fetch(`${connection.url}/v1/events`, { headers, signal: abort.signal }));
  assert.equal((await stream.next()).value?.type, "ready");
  const consume = (async () => {
    for await (const frame of stream) {
      const event = frame.data;
      events.push(event);
      for (const listener of [...waiters]) listener(event);
    }
  })();
  const selection = { providerId, modelId, reasoning: null };
  const create = async (permissionMode = "ask_before_changes") => {
    const conversation = sharedId === undefined
      ? await request("conversations.create", { modelSelection: selection })
      : (await request("conversations.list")).find((item) => item.id === sharedId);
    assert.ok(conversation && !conversation.isArchived);
    if (sharedId === undefined) sharedId = conversation.id;
    assert.deepEqual(conversation.modelSelection, selection);
    await request("conversations.set_permission", { conversationId: conversation.id, permissionMode });
    await request("conversations.open", { conversationId: conversation.id });
    return conversation.id;
  };
  const send = (id, content, deliveryMode = "queue") => request("messages.send", { conversationId: id, content, deliveryMode });
  const finish = async (id, submission, status = "completed") => {
    let runId = submission.runId;
    if (submission.kind === "pending") {
      const consumed = await wait((event) => event.type === "pending_messages.updated" && event.conversationId === id
        && event.consumedMessages?.some((message) => message.id === submission.pendingMessage.id));
      runId = consumed.consumedMessages.find((message) => message.id === submission.pendingMessage.id).runId;
    }
    const event = await wait((event) => event.type === "run.finished" && event.runId === runId);
    assert.equal(event.status, status);
    const items = await timeline(id);
    const replies = items.filter((item) => item.kind === "message" && item.role === "assistant" && item.runId === runId);
    const failures = items.filter((item) => item.kind === "tool" && item.runId === runId && ["failed", "rejected"].includes(item.status));
    for (const tool of failures) assert.ok((currentCase === "deny_file" && tool.name === "write_file" && tool.status === "rejected")
      || (currentCase === "tool_error" && tool.name === "read_file") || currentCase === "read_only", `Unexpected ${tool.name} failure: ${tool.result?.slice(0, 300)}`);
    if (status === "completed") assert.ok(replies.some((item) => item.content.trim().length > 0), "Completed Run has no saved reply.");
    let logErrors = 0;
    if (logPath !== undefined) {
      const log = await readFile(logPath, "utf8");
      const newLines = log.slice(logOffset).split("\n"); logOffset = log.length;
      const rendererErrors = newLines.filter((line) => /renderer_console|renderer_unhandled|uncaughtException|unhandledRejection/iu.test(line));
      assert.equal(rendererErrors.length, 0, "New Renderer or unhandled Main error in the desktop log.");
      logErrors = newLines.filter((line) => /\b(?:INTERNAL_ERROR|MODEL_[A-Z_]+|ERROR)\b/u.test(line)).length;
    }
    console.log(JSON.stringify({ type: "round.reviewed", case: currentCase, conversationId: id, runId, status,
      reply: replies.at(-1)?.content.slice(0, 160) ?? null, logErrors, expectedToolFailures: failures.map((item) => ({ name: item.name, status: item.status })) }));
    return runId;
  };
  const readTimeline = async (id) => (await request("conversations.read", { conversationId: id, limit: 200 })).items;
  const timeline = async (id) => (await readTimeline(id)).filter((item) => !phaseItemIds.has(item.id));
  const tools = async (id, name) => (await timeline(id)).filter((item) => item.kind === "tool" && item.name === name);
  const question = async (id) => (await wait((event) => events.indexOf(event) >= phaseOffset && event.type === "user_question.updated" && event.reason === "created" && event.conversationId === id)).question;
  const answer = (q, value, expected) => request("user_questions.answer", { questionId: q.id, answers: { scope: value } }, expected);
  const currentQuestion = async (q) => (await request("user_questions.list", { conversationId: q.displayConversationId })).find((item) => item.id === q.id);
  const deliverAnswer = async (q, value) => {
    const current = await currentQuestion(q);
    return answer(q, current.status === "answered" ? current.answers.scope : value);
  };
  const ask = (label, suffix) => `[后台验收·${label}] 本轮只执行当前说明，之前的测试已经结束。必须调用 request_user_input，questions 只有一个问题：id=scope，title=测试范围，question=${["等待超时", "取消等待", "重启恢复"].includes(label) ? "这是自动等待或重启检查，请暂时不要回答" : "这是后台自动回答验收，无需手动操作，请选择测试范围"}，options=${["等待超时", "取消等待", "重启恢复"].includes(label) ? "[]" : "[{label:设置页面},{label:全部页面}]"}。${suffix}不要用普通文字代替提问工具，不要重复发问。`;
  const approval = (id) => wait((event) => events.indexOf(event) >= phaseOffset && event.type === "tool.approval_requested" && event.conversationId === id);
  const decide = async (event, approved, check) => {
    assert.ok(check(event.tool), "Unexpected side effect; approval refused by acceptance script.");
    return request("approvals.resolve", { toolId: event.tool.id, runId: event.runId, approved, scope: "once" });
  };
  const results = [];
  const run = async (name, scenario) => {
    if ((name.startsWith("restart_") && only !== name) || (only && only !== name)) return;
    if (!reachedStart) { if (name !== from) return; reachedStart = true; }
    currentCase = name;
    phaseOffset = events.length;
    phaseItemIds = new Set(sharedId === undefined ? [] : (await readTimeline(sharedId)).map((item) => item.id));
    try {
      await scenario();
      const result = { case: name, ok: true, conversationId: sharedId };
      results.push(result); console.log(JSON.stringify(result));
    } catch (error) {
      if (sharedId !== undefined) await request("runs.cancel", { conversationId: sharedId }).catch(() => {});
      const result = { case: name, ok: false, error: error.message, conversationId: sharedId };
      results.push(result); console.log(JSON.stringify(result));
      throw error;
    }
  };
  try {
    const status = await request("models.status");
    const configured = status.models.find((model) => model.providerId === providerId && model.modelId === modelId);
    assert.ok(configured, "Requested supplier/model is not configured.");
    assert.equal(configured.contextWindow, 200000, "Expected the user's 200K model context.");
    await run("multi_turn", async () => {
      const id = await create();
      for (const marker of ["ROUND_ONE", "ROUND_TWO"]) await finish(id, await send(id, `[后台验收·普通多轮] 只回答 ${marker}，不调用工具。`));
      const messages = (await timeline(id)).filter((item) => item.kind === "message");
      assert.equal(messages.filter((item) => item.role === "user").length, 2);
      assert.equal(messages.filter((item) => item.role === "assistant").length, 2);
      assert.ok(events.some((event, index) => index >= phaseOffset && event.type === "assistant.delta" && event.conversationId === id));
    });
    await run("async_question", async () => {
      const id = await create();
      const firstRunId = await finish(id, await send(id, ask("异步提问", "工具返回后直接回复 INDEPENDENT_WORK_DONE 并正常结束，不等待答案；之后收到用户回答时回复 ANSWER_RECEIVED 加上答案。")));
      const q = await question(id);
      const current = await currentQuestion(q);
      await request("conversations.open", { conversationId: id });
      if (current.status === "pending") await wait((event) => event.type === "user_question.updated" && event.reason === "viewed" && event.question.id === q.id, 10000);
      await request("user_questions.answer", { questionId: q.id, answers: {} }, 500);
      const beforeDelivery = await currentQuestion(q);
      const saved = await deliverAnswer(q, "设置页面");
      assert.equal(saved.deliveryComplete, true);
      const wake = events.find((event, index) => index >= phaseOffset && event.type === "run.started" && event.conversationId === id && event.runId !== firstRunId);
      if (beforeDelivery.status === "pending" || wake) {
        const started = wake ?? await wait((event) => events.indexOf(event) >= phaseOffset && event.type === "run.started" && event.conversationId === id && event.runId !== firstRunId);
        await finish(id, { kind: "started", runId: started.runId });
      }
      const before = (await timeline(id)).filter((item) => item.kind === "message" && item.role === "user").length;
      await answer(q, saved.answers.scope);
      assert.equal((await timeline(id)).filter((item) => item.kind === "message" && item.role === "user").length, before);
      await answer(q, "不同回答", 500);
      assert.ok((await timeline(id)).some((item) => item.kind === "message" && item.role === "assistant" && item.content.includes(saved.answers.scope)));
    });
    await run("wait_queue_steer", async () => {
      const id = await create();
      const first = await send(id, ask("等待与投递", "获得 questionId 后必须调用 wait_for_user_input，timeoutMs=60000；等待结束后整合收到的指令回答，不调用别的工具。"));
      const q = await question(id);
      await wait((event) => events.indexOf(event) >= phaseOffset && event.type === "tool.started" && event.conversationId === id && event.tool.name === "wait_for_user_input");
      const queued = await send(id, "QUEUED_NEXT_ROUND：这条应在当前运行结束后处理，只回复 QUEUE_RECEIVED。", "queue");
      const steered = await send(id, "STEER_CURRENT_ROUND：请在当前回复中包含 STEER_RECEIVED。", "steer");
      assert.equal(queued.kind, "pending"); assert.equal(steered.kind, "pending");
      await deliverAnswer(q, "全部页面");
      await finish(id, first); await finish(id, queued);
      const items = await timeline(id);
      assert.ok(items.some((item) => item.kind === "message" && item.role === "assistant" && item.content.includes("STEER_RECEIVED")));
      assert.ok(items.some((item) => item.kind === "message" && item.role === "assistant" && item.content.includes("QUEUE_RECEIVED")));
    });
    await run("cancel_question", async () => {
      const id = await create(); const submitted = await send(id, ask("取消等待", "必须调用 wait_for_user_input，timeoutMs=60000；有答案再继续。"));
      const q = await question(id);
      await wait((event) => events.indexOf(event) >= phaseOffset && event.type === "tool.started" && event.conversationId === id && event.tool.name === "wait_for_user_input");
      await request("runs.cancel", { conversationId: id }); await finish(id, submitted, "cancelled");
      assert.ok(["cancelled", "answered"].includes((await currentQuestion(q)).status));
      await answer(q, "取消后重新回答", 500);
    });
    await run("question_timeout", async () => {
      const id = await create();
      await finish(id, await send(id, ask("等待超时", "必须调用 wait_for_user_input，timeoutMs=1000；超时后正常回复 WAIT_TIMED_OUT，不取消提问，不再次等待。")));
      assert.ok((await tools(id, "wait_for_user_input")).some((item) => item.result?.includes("timed_out")));
      assert.equal((await request("user_questions.list", { conversationId: id }))[0].status, "pending");
    });
    for (const approved of [true, false]) await run(approved ? "approve_file" : "deny_file", async () => {
      const id = await create(); const file = approved ? "approved-fixture.txt" : "denied-fixture.txt";
      const submitted = await send(id, `[后台验收·${approved ? "批准" : "拒绝"}写入] 必须调用 write_file 创建 ${file}，内容 DESKTOP_FILE_FIXTURE。审批后${approved ? "用 read_file 读回" : "无论结果如何结束，拒绝时不重试、不用其他工具绕过"}，然后简短报告结果。`);
      const event = await approval(id);
      await decide(event, approved, (tool) => tool.name === "write_file" && JSON.parse(tool.arguments).path === file && JSON.parse(tool.arguments).content.trim() === "DESKTOP_FILE_FIXTURE");
      await finish(id, submitted);
      const writes = await tools(id, "write_file"); assert.equal(writes.length, 1);
      assert.equal(writes[0].status, approved ? "completed" : "rejected");
      if (approved) assert.ok((await tools(id, "read_file")).some((item) => item.result?.includes("DESKTOP_FILE_FIXTURE")));
      await request("approvals.resolve", { toolId: event.tool.id, runId: event.runId, approved: true }, 500);
    });
    await run("read_only", async () => {
      const id = await create("read_only");
      await finish(id, await send(id, "[后台验收·只读权限] 尝试通过 write_file 创建 readonly-fixture.txt，内容 READ_ONLY_TEST。如果工具不可用则说明只读限制，不使用命令或其他工具绕过。"));
      assert.ok(!(await tools(id, "write_file")).some((tool) => tool.status === "completed"));
      assert.ok(!events.some((event, index) => index >= phaseOffset && event.type === "tool.approval_requested" && event.conversationId === id));
    });
    await run("tool_error", async () => {
      const id = await create();
      await finish(id, await send(id, "[后台验收·工具错误] 必须调用 read_file 读取 missing-desktop-fixture-9d41.txt；文件预期不存在。失败后不要创建文件、不要重试，只说明文件不存在并正常结束。"));
      assert.ok((await tools(id, "read_file")).some((tool) => tool.status === "failed"));
    });
    await run("background_program", async () => {
      const id = await create(); const command = 'node -e "setInterval(() => {}, 1000)"';
      const submitted = await send(id, `[后台验收·后台程序] 必须调用 run_command，command=${JSON.stringify(command)}，mode=service，serviceName=桌面后台验收，yieldTimeMs=100。启动后回复 SERVICE_STARTED 并结束，不自行停止服务。`);
      await decide(await approval(id), true, (tool) => tool.name === "run_command" && JSON.parse(tool.arguments).command === command && JSON.parse(tool.arguments).mode === "service");
      await finish(id, submitted);
      const programs = await request("background_commands.list", { conversationId: id });
      const program = programs.find((item) => item.status === "running"); assert.ok(program);
      const other = (await request("conversations.list")).find((item) => item.id !== id && item.parentConversationId === null);
      assert.ok(other);
      await request("background_commands.stop", { conversationId: other.id, commandId: program.commandId }, 500);
      assert.ok(!(await request("background_commands.list", { conversationId: other.id })).some((item) => item.commandId === program.commandId));
      const stopped = await request("background_commands.stop", { conversationId: id, commandId: program.commandId });
      assert.equal(stopped.status, "cancelled"); assert.notEqual(stopped.completedAt, null);
    });
    await run("subagent_question", async () => {
      const id = await create();
      const submitted = await send(id, `[后台验收·子代理提问] 必须调用 spawn_subagent，name=提问验收子代理，providerId=${providerId}，modelId=${modelId}，task="调用 request_user_input，只提一个问题 id=scope title=子代理范围 question=选择范围 options=[]。获得 questionId 后调用 wait_for_user_input timeoutMs=60000，收到回答后最终回复 CHILD_ANSWER_RECEIVED 加答案，不再次提问。"。父代理随后用 wait_for_subagents 等待任务，最终汇总子代理的答案。不要替子代理直接提问。`);
      const q = await question(id); assert.notEqual(q.conversationId, id);
      const conversations = await request("conversations.list");
      assert.deepEqual(conversations.find((item) => item.id === q.conversationId).modelSelection, selection);
      const saved = await deliverAnswer(q, "手机远程页面");
      await wait((event) => event.type === "run.finished" && event.conversationId === q.conversationId);
      await finish(id, submitted);
      assert.ok((await timeline(q.conversationId)).some((item) => item.kind === "message" && item.role === "assistant" && item.content.includes(saved.answers.scope)));
    });
    await run("late_answer", async () => {
      const id = await create();
      const pending = (await request("user_questions.list", { conversationId: id })).find((q) => q.status === "pending" && q.conversationId === id);
      if (!pending) return;
      const offset = events.length;
      const saved = await deliverAnswer(pending, "后台补答：完成超时验收"); assert.equal(saved.deliveryComplete, true);
      const started = await wait((event) => events.indexOf(event) >= offset && event.type === "run.started" && event.conversationId === id);
      await finish(id, { kind: "started", runId: started.runId });
    });
    await run("restart_pending", async () => {
      assert.ok(restartFile, "--restart-file is required for restart acceptance.");
      const id = await create();
      await finish(id, await send(id, ask("重启恢复", "发问后正常回复 RESTART_READY，不等待答案。稍后收到回答时回复 RESTART_ANSWER_RECEIVED 加答案。")));
      const q = await question(id);
      await writeFile(restartFile, JSON.stringify({ conversationId: id, questionId: q.id, selection }));
    });
    await run("restart_answer", async () => {
      assert.ok(restartFile, "--restart-file is required for restart acceptance.");
      const saved = JSON.parse(await readFile(restartFile, "utf8")); assert.deepEqual(saved.selection, selection);
      const q = (await request("user_questions.list", { conversationId: saved.conversationId })).find((item) => item.id === saved.questionId);
      assert.equal(q.status, "pending"); await request("conversations.open", { conversationId: saved.conversationId });
      const offset = events.length; await answer(q, "重启后设置页面");
      const started = await wait((event) => events.indexOf(event) >= offset && event.type === "run.started" && event.conversationId === saved.conversationId);
      await finish(saved.conversationId, { kind: "started", runId: started.runId });
      assert.ok((await timeline(saved.conversationId)).some((item) => item.kind === "message" && item.role === "assistant" && item.content.includes("重启后设置页面")));
      sharedId = saved.conversationId;
    });
    assert.ok(results.length > 0, "Unknown --case.");
    console.log(JSON.stringify({ type: "scenarios.finished", ok: results.every((item) => item.ok), passed: results.filter((item) => item.ok).length, total: results.length, conversationId: sharedId, providerId, modelId, contextWindow: configured.contextWindow }));
    return results.every((item) => item.ok) ? 0 : 1;
  } finally { abort.abort(); await consume.catch(() => {}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  if (!value("--connection") || !value("--provider")) throw new Error("Usage: node scripts/aster-control-scenarios.mjs --connection <file> --provider <UUID> [--conversation <UUID>] [--model <ID>] [--from <case>|--case <case>] [--restart-file <file>] [--log <file>]");
  desktopScenarios({ connectionPath: value("--connection"), providerId: value("--provider"), modelId: value("--model"), only: value("--case"), restartFile: value("--restart-file"), conversationId: value("--conversation"), from: value("--from"), logPath: value("--log") })
    .then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
