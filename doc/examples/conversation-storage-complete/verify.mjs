// Read-only fixture verifier. This is not the application's importer or runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = value => assert.ok(typeof value === 'string' && guid.test(value), `Invalid UUID: ${value}`);
const jsonl = text => text.trimEnd().split(/\r?\n/).map(line => JSON.parse(line));
const read = relative => {
  assert.ok(!path.isAbsolute(relative));
  const full = fs.realpathSync(path.resolve(root, relative));
  const inside = path.relative(root, full);
  assert.ok(inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside));
  return fs.readFileSync(full);
};
const config = JSON.parse(read('fixture-config.json').toString('utf8'));
const bundle = {
  config,
  logs: config.scenarios.map(meta => ({ meta, events: jsonl(read(meta.logPath).toString('utf8')) })),
  teamEvents: jsonl(read(config.teamLogPath).toString('utf8')),
  assets: {},
};
for (const { meta, events } of bundle.logs) {
  for (const e of events.filter(e => e.type === 'attachment_imported')) {
    const p = e.payload.relativePath;
    assert.match(p, /^attachments\/[a-zA-Z0-9._-]+$/);
    const file = path.posix.join(path.posix.dirname(meta.logPath), p);
    bundle.assets[`${meta.conversationId}/${p}`] = read(file).length;
  }
}

function validate(data) {
  const eventIds = new Set(), entities = new Set(), conversations = new Map();
  const sent = new Map(), received = new Map(), acknowledgements = [];
  const checkpoints = new Map(), seeds = [], messages = new Map(), teamRuns = [], deliveryPlans = [];
  let eventCount = 0, runCount = 0, toolCount = 0;
  function entity(id) { validId(id); assert.ok(!entities.has(id), `Duplicate entity: ${id}`); entities.add(id); }
  function envelope(events, field, id, headerType) {
    validId(id); assert.equal(events[0].type, headerType); assert.equal(events[0][field], id);
    assert.equal(events[0].version, 2); let previousTime = Date.parse(events[0].createdAt);
    assert.ok(Number.isFinite(previousTime));
    for (const [i, e] of events.entries()) {
      assert.equal(e.version, 2); assert.equal(e[field], id);
      assert.ok(Date.parse(e.createdAt) >= previousTime); previousTime = Date.parse(e.createdAt);
      if (i === 0) continue;
      assert.equal(e.sequence, i); validId(e.eventId); assert.ok(!eventIds.has(e.eventId));
      eventIds.add(e.eventId); assert.ok(e.payload && typeof e.payload === 'object'); eventCount++;
    }
  }
  function model(selection) {
    assert.deepEqual(Object.keys(selection).sort(), ['modelId', 'providerId', 'reasoning']);
    const provider = data.config.providers.find(p => p.id === selection.providerId);
    assert.ok(provider); assert.ok(provider.models.some(m => m.modelId === selection.modelId));
    assert.ok(selection.reasoning === null || typeof selection.reasoning === 'object');
  }
  for (const entry of data.logs) {
    const { meta, events } = entry;
    assert.ok(!conversations.has(meta.conversationId)); conversations.set(meta.conversationId, entry);
    envelope(events, 'conversationId', meta.conversationId, 'thread_header');
    assert.equal(events[1].type, 'conversation_created');
  }
  for (const { meta, events } of data.logs) {
    const localMessages = new Map(), runs = new Map(), calls = new Map(), tools = new Map();
    const approvals = new Map(), attachments = new Set(), consumed = new Set(), compacting = new Map();
    let props, active = null, ended = false, lastCheckpoint = null, lastBoundary = 0;
    const activeRun = id => { assert.equal(active, id); assert.ok(runs.has(id)); return runs.get(id); };
    function incoming(id, content, kind) {
      assert.ok(!ended); entity(id); assert.equal(typeof content, 'string');
      const m = { conversationId: meta.conversationId, content, kind, finished: true };
      localMessages.set(id, m); messages.set(id, m);
    }
    function consume(ids) {
      assert.ok(ids.length > 0);
      for (const id of ids) {
        const m = localMessages.get(id); assert.ok(m && m.kind !== 'assistant');
        assert.ok(!consumed.has(id)); consumed.add(id);
      }
    }
    for (const e of events.slice(1)) {
      const p = e.payload;
      switch (e.type) {
        case 'conversation_created': {
          assert.equal(props, undefined); props = structuredClone(p.properties); model(props.modelSelection);
          assert.deepEqual(Object.keys(props).sort(), ['agentId','archivedAt','avatarIcon','mode','modelSelection','parentConversationId','permissionMode','pinOrder','projectId','title'].sort());
          assert.ok(['persistent','subagent'].includes(props.mode));
          assert.ok(data.config.agents.some(a => a.id === props.agentId));
          assert.ok(['user','subagent','side','team','conversation'].includes(p.origin.kind));
          if (props.parentConversationId) assert.ok(conversations.has(props.parentConversationId));
          if (props.mode === 'subagent' || p.origin.kind === 'side') assert.ok(props.parentConversationId);
          if (p.origin.kind === 'team') assert.equal(p.origin.teamInstanceId, data.teamEvents[0].teamInstanceId);
          break;
        }
        case 'conversation_properties_changed':
          assert.ok(!ended); for (const k of Object.keys(p.changes)) assert.ok(['title','agentId','avatarIcon','projectId','modelSelection','permissionMode','archivedAt','pinOrder'].includes(k));
          if ('projectId' in p.changes) assert.equal(active, null);
          props = { ...props, ...p.changes }; model(props.modelSelection); break;
        case 'attachment_imported':
          entity(p.attachmentId); assert.match(p.relativePath, /^attachments\/[a-zA-Z0-9._-]+$/);
          assert.equal(data.assets[`${meta.conversationId}/${p.relativePath}`], p.sizeBytes);
          assert.ok(['file_picker','paste','copy'].includes(p.importMethod)); attachments.add(p.attachmentId); break;
        case 'user_message':
          incoming(p.messageId, p.content, 'user'); for (const id of p.attachmentIds) assert.ok(attachments.has(id)); break;
        case 'conversation_message_sent':
          entity(p.messageId); entity(p.deliveryId); assert.ok(conversations.has(p.targetConversationId));
          assert.equal(p.deliveryMode, 'queue'); sent.set(p.deliveryId, { ...p, sourceConversationId: meta.conversationId }); break;
        case 'conversation_message_received':
          assert.equal(p.targetConversationId, meta.conversationId); assert.ok(!received.has(p.deliveryId));
          incoming(p.messageId, p.content, 'conversation'); Object.assign(localMessages.get(p.messageId), { deliveryId: p.deliveryId, expectReply: p.expectReply }); received.set(p.deliveryId, p); break;
        case 'conversation_message_delivered': acknowledgements.push({ ...p, sourceConversationId: meta.conversationId }); break;
        case 'run_started': {
          assert.ok(!ended); assert.equal(active, null); entity(p.runId); consume(p.triggerMessageIds);
          const s = p.executionSnapshot; model(s.modelSelection);
          for (const k of ['agentId','modelSelection','permissionMode','projectId']) assert.deepEqual(s[k], props[k]);
          assert.equal(s.agentSnapshot.id, s.agentId); assert.equal(typeof s.agentSnapshot.instructions, 'string');
          assert.deepEqual(s.toolManifest, data.config.toolDefinitions);
          const project = data.config.projects.find(q => q.id === props.projectId);
          assert.equal(s.projectName, project?.name ?? null); assert.equal(s.projectRootPath, project?.rootPath ?? null);
          assert.equal(s.workspaceRootPath, project?.rootPath ?? null);
          assert.equal(p.contextCheckpointId, lastCheckpoint);
          if (s.teamBinding) teamRuns.push({ conversationId: meta.conversationId, binding: s.teamBinding });
          runs.set(p.runId, p); active = p.runId; runCount++; break;
        }
        case 'run_input_consumed': activeRun(p.runId); consume(p.messageIds); assert.equal(p.mode, 'safe_boundary'); break;
        case 'model_call_started':
          activeRun(p.runId); entity(p.modelCallId); entity(p.attemptId);
          assert.deepEqual(p.modelSelection, runs.get(p.runId).executionSnapshot.modelSelection);
          calls.set(p.modelCallId, { ...p, finished: false }); break;
        case 'model_call_finished': {
          activeRun(p.runId); const c = calls.get(p.modelCallId); assert.ok(c && !c.finished); assert.equal(c.runId, p.runId);
          for (const n of Object.values(p.usage)) assert.ok(n === null || (Number.isInteger(n) && n >= 0));
          c.finished = true; break;
        }
        case 'assistant_message_started': {
          activeRun(p.runId); const c = calls.get(p.modelCallId); assert.ok(c && !c.finished); assert.equal(c.runId, p.runId);
          entity(p.messageId); assert.ok(['commentary','final','reasoning_summary','reasoning_content'].includes(p.channel));
          const m = { ...p, conversationId: meta.conversationId, kind: 'assistant', content: '', parts: 0, finished: false };
          localMessages.set(p.messageId, m); messages.set(p.messageId, m); break;
        }
        case 'assistant_message_delta': {
          const m = localMessages.get(p.messageId); assert.ok(m && !m.finished); assert.equal(p.partIndex, m.parts++);
          assert.equal(typeof p.text, 'string'); m.content += p.text; break;
        }
        case 'assistant_message_finished': {
          const m = localMessages.get(p.messageId); assert.ok(m && !m.finished); assert.ok(['completed','interrupted'].includes(p.status));
          assert.deepEqual(p.artifactIds, []); m.finished = true; break;
        }
        case 'tool_call_requested': {
          activeRun(p.runId); const c = calls.get(p.modelCallId); assert.ok(c && !c.finished); assert.equal(c.runId, p.runId);
          entity(p.toolCallId); const definition = data.config.toolDefinitions.find(t => t.name === p.name); assert.ok(definition);
          assert.deepEqual(Object.keys(p.arguments).sort(), definition.parameters.required.slice().sort());
          tools.set(p.toolCallId, { ...p, stage: 'requested', approved: false, part: 0 }); toolCount++; break;
        }
        case 'tool_execution_prepared': {
          activeRun(p.runId); const t = tools.get(p.toolCallId); assert.equal(t?.stage, 'requested'); assert.equal(t.runId, p.runId);
          entity(p.operationId); Object.assign(t, p, { stage: 'prepared' }); break;
        }
        case 'tool_approval_requested': {
          activeRun(p.runId); const t = tools.get(p.toolCallId); assert.equal(t?.stage, 'prepared'); assert.ok(t.approvalRequired);
          assert.equal(p.scopeConversationId, meta.conversationId); assert.equal(p.requestedBy.conversationId, meta.conversationId);
          entity(p.approvalId); approvals.set(p.approvalId, p); break;
        }
        case 'tool_approval_decided': {
          activeRun(p.runId); const a = approvals.get(p.approvalId); assert.ok(a); assert.equal(a.toolCallId, p.toolCallId);
          assert.equal(a.runId, p.runId); assert.equal(p.scopeConversationId, meta.conversationId);
          assert.equal(p.actor.kind, 'user'); assert.ok(conversations.has(p.actor.viaConversationId)); assert.equal(p.decision, 'allow_once');
          const t = tools.get(p.toolCallId); assert.ok(!t.approved); t.approved = true; break;
        }
        case 'tool_started': {
          activeRun(p.runId); const t = tools.get(p.toolCallId); assert.equal(t?.stage, 'prepared'); assert.equal(t.operationId, p.operationId);
          assert.ok(!t.approvalRequired || t.approved); t.stage = 'running'; break;
        }
        case 'tool_output_delta': {
          const t = tools.get(p.toolCallId); assert.equal(t?.stage, 'running'); assert.equal(p.partIndex, t.part++);
          assert.ok(['stdout','stderr'].includes(p.stream)); assert.equal(typeof p.text, 'string'); break;
        }
        case 'tool_result': {
          activeRun(p.runId); const t = tools.get(p.toolCallId); assert.equal(t?.stage, 'running'); assert.equal(t.runId, p.runId);
          assert.ok(['completed','failed','cancelled'].includes(p.status)); assert.equal(p.outputComplete, true); t.stage = 'finished'; break;
        }
        case 'run_terminal': {
          activeRun(p.runId); const m = localMessages.get(p.finalMessageId); assert.ok(m?.finished); assert.equal(m.runId, p.runId); assert.equal(m.channel, 'final');
          assert.ok([...tools.values()].filter(t => t.runId === p.runId).every(t => t.stage === 'finished'));
          assert.ok([...calls.values()].filter(c => c.runId === p.runId).every(c => c.finished));
          assert.ok([...localMessages.values()].filter(m => m.runId === p.runId).every(m => m.finished));
          const replyIds = runs.get(p.runId).triggerMessageIds.map(id => localMessages.get(id)).filter(m => m.expectReply).map(m => m.deliveryId).sort();
          assert.deepEqual(p.pendingDeliveries.map(d => d.replyToDeliveryId).sort(), replyIds);
          for (const plan of p.pendingDeliveries) deliveryPlans.push({ sourceConversationId: meta.conversationId, plan });
          assert.equal(p.status, 'completed'); active = null; break;
        }
        case 'context_compaction_started':
          assert.equal(active, null); entity(p.checkpointId); assert.equal(p.previousCheckpointId, lastCheckpoint); model(p.modelSelection);
          compacting.set(p.checkpointId, p); break;
        case 'context_compaction_completed': {
          assert.equal(active, null); const start = compacting.get(p.checkpointId); assert.ok(start);
          assert.equal(p.previousCheckpointId, lastCheckpoint); assert.equal(p.coveredThroughSequence, start.coveredThroughSequence);
          assert.ok(p.coveredThroughSequence > lastBoundary && p.coveredThroughSequence < e.sequence);
          const boundary = events[p.coveredThroughSequence]; assert.equal(boundary.eventId, p.coveredThroughEventId); assert.equal(boundary.type, 'run_terminal');
          for (const id of p.summary.attachmentIds) assert.ok(attachments.has(id));
          checkpoints.set(p.checkpointId, { ...p, conversationId: meta.conversationId });
          lastCheckpoint = p.checkpointId; lastBoundary = p.coveredThroughSequence; compacting.delete(p.checkpointId); break;
        }
        case 'context_seeded':
          assert.equal(events[1].payload.origin.kind, 'side'); assert.equal(p.visibility, 'context_only'); assert.equal(active, null);
          for (const id of Object.values(p.snapshot.attachmentIdMap)) assert.ok(attachments.has(id));
          for (const id of p.snapshot.summary.attachmentIds) assert.ok(attachments.has(id));
          seeds.push({ ...p, conversationId: meta.conversationId }); break;
        case 'conversation_ended': assert.equal(active, null); assert.ok(!ended); assert.ok(conversations.has(p.actor.conversationId)); ended = true; break;
        case 'conversation_read': assert.ok(localMessages.get(p.throughMessageId)?.finished); break;
        default: assert.fail(`Unspecified sample event: ${e.type}`);
      }
    }
    assert.equal(active, null); assert.equal(compacting.size, 0);
  }
  for (const [id, r] of received) {
    const s = sent.get(id); assert.ok(s, `Missing sender for ${id}`);
    for (const k of ['sourceConversationId','targetConversationId','replyToDeliveryId','content','attachmentIds','expectReply','deliveryMode']) assert.deepEqual(r[k], s[k]);
    assert.equal(r.sourceMessageId, s.messageId);
  }
  assert.equal(sent.size, received.size);
  for (const { sourceConversationId, plan } of deliveryPlans) {
    const s = sent.get(plan.deliveryId); assert.ok(s); assert.equal(s.sourceConversationId, sourceConversationId);
    const recorded = { ...s }; delete recorded.sourceConversationId; assert.deepEqual(plan, recorded);
  }
  for (const s of sent.values()) if (s.replyToDeliveryId) {
    const original = sent.get(s.replyToDeliveryId); assert.ok(original?.expectReply);
    assert.equal(s.sourceConversationId, original.targetConversationId); assert.equal(s.targetConversationId, original.sourceConversationId);
  }
  assert.equal(acknowledgements.length, sent.size);
  const ackIds = new Set();
  for (const a of acknowledgements) {
    assert.ok(!ackIds.has(a.deliveryId)); ackIds.add(a.deliveryId);
    const s = sent.get(a.deliveryId), r = received.get(a.deliveryId); assert.ok(s && r);
    assert.equal(a.sourceConversationId, s.sourceConversationId); assert.equal(a.targetConversationId, s.targetConversationId); assert.equal(a.targetMessageId, r.messageId);
  }
  for (const seed of seeds) {
    const cp = checkpoints.get(seed.sourceCheckpointId); assert.ok(cp); assert.equal(cp.conversationId, seed.sourceConversationId);
    assert.equal(cp.coveredThroughEventId, seed.sourceThroughEventId); assert.equal(cp.coveredThroughSequence, seed.sourceThroughSequence);
    const expected = structuredClone(cp.summary); expected.attachmentIds = expected.attachmentIds.map(id => seed.snapshot.attachmentIdMap[id]);
    assert.deepEqual(seed.snapshot.summary, expected); assert.deepEqual(seed.snapshot.messages, []);
  }
  const team = data.teamEvents;
  envelope(team, 'teamInstanceId', team[0].teamInstanceId, 'team_header');
  assert.equal(team[1].type, 'team_created'); const members = team[1].payload.members;
  assert.equal(members.filter(m => m.role === 'lead').length, 1);
  for (const m of members) assert.ok(conversations.has(m.conversationId));
  assert.equal(team[2].type, 'team_work_item_created'); assert.equal(team[3].type, 'team_work_item_completed');
  assert.equal(team[2].payload.workItemId, team[3].payload.workItemId);
  assert.equal(messages.get(team[2].payload.sourceMessageId)?.conversationId, team[2].payload.sourceConversationId);
  assert.equal(messages.get(team[3].payload.resultMessageId)?.conversationId, team[3].payload.resultConversationId);
  for (const r of teamRuns) {
    assert.equal(r.binding.teamInstanceId, team[0].teamInstanceId); assert.equal(r.binding.teamId, team[1].payload.teamId);
    assert.equal(r.binding.workItemId, team[2].payload.workItemId);
    assert.ok(members.some(m => m.conversationId === r.conversationId && m.role === r.binding.role));
  }
  return { conversations: data.logs.length, events: eventCount, runs: runCount, tools: toolCount, deliveries: sent.size, checkpoints: checkpoints.size, sideSeeds: seeds.length };
}

const report = validate(bundle);
function find(data, type) { return data.logs.flatMap(l => l.events).find(e => e.type === type); }
const cases = [
  ['sequence gap', d => { find(d, 'user_message').sequence += 1; }],
  ['unknown provider', d => { find(d, 'run_started').payload.executionSnapshot.modelSelection.providerId = 'missing'; }],
  ['wrong project path', d => { find(d, 'run_started').payload.executionSnapshot.projectRootPath = 'E:/wrong'; }],
  ['missing tool result', d => { const e = find(d, 'tool_result'); e.payload.toolCallId = 'missing'; }],
  ['approval scope mismatch', d => { find(d, 'tool_approval_decided').payload.scopeConversationId = d.logs[1].meta.conversationId; }],
  ['approval refused but execution started', d => { find(d, 'tool_approval_decided').payload.decision = 'deny'; }],
  ['broken stream index', d => { find(d, 'assistant_message_delta').payload.partIndex = 3; }],
  ['forged sender', d => { find(d, 'conversation_message_received').payload.sourceConversationId = d.logs[1].meta.conversationId; }],
  ['broken reply chain', d => { find(d, 'conversation_message_sent').payload.replyToDeliveryId = 'missing'; }],
  ['split compression boundary', d => { find(d, 'context_compaction_completed').payload.coveredThroughSequence -= 1; }],
  ['missing side context source', d => { find(d, 'context_seeded').payload.sourceCheckpointId = 'missing'; }],
  ['attachment traversal', d => { find(d, 'attachment_imported').payload.relativePath = '../../outside.txt'; }],
  ['missing team member', d => { d.teamEvents[1].payload.members[0].conversationId = 'missing'; }],
  ['lost terminal receipt plan', d => { d.logs.flatMap(l => l.events).find(e => e.type === 'run_terminal' && e.payload.pendingDeliveries.length).payload.pendingDeliveries = []; }],
];
for (const [name, mutate] of cases) {
  const bad = structuredClone(bundle); mutate(bad); assert.throws(() => validate(bad), undefined, name);
}
const previews = [
  ...bundle.logs.map(({ meta, events }) => ({ previewPath: meta.previewPath, events })),
  { previewPath: config.teamLogPath.replace(/\.jsonl$/, '.preview.md'), events: bundle.teamEvents },
];
for (const { previewPath, events } of previews) {
  const text = read(previewPath).toString('utf8').replace(/\r\n/g, '\n');
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)```/g)];
  assert.equal(blocks.length, 1); assert.equal(blocks[0][1].trim(), events.map(e => JSON.stringify(e, null, 2)).join('\n\n'));
}
console.log(JSON.stringify({ ...report, negativeCases: cases.length, previewParity: 'passed', diskWrites: false }, null, 2));
