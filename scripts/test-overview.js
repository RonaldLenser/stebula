// Tests for the overview of one interaction and for how model failures are told apart.
// These are the places the interface could mislead: a refusal is not a malformed answer, a reply after a failed
// proposal step is not a clean success, "saved", "unchanged" and "failed to save" are three different things,
// history comes from history, and one agent's records never appear in another's overview.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processModel, agentMsg, turnList } from '../src/talk/process.js';
import { overviewModel, noticeFor, FAILURE_WORDS } from '../src/talk/overview.js';
import { applyStage, emptyBrain } from '../src/talk/brain.js';
import { runStage, StageError } from '../src/lib/stage.js';
import { errorInfo } from '../src/lib/http-errors.js';
import { VALIDATORS, SCHEMAS } from '../src/talk/schemas.js';
import { makeTalkStore, talkTurn } from '../src/talk/session.js';
import { makeFakeLLM } from '../src/dev/fake-llm.js';
import { thinkSystem, PROMPT_VERSION } from '../src/talk/prompts.js';
import { buildContext } from '../src/talk/context.js';
import { freshAffect } from '../src/talk/workspace.js';
import { freshTalkMemory } from '../src/talk/session.js';

const fixture = JSON.parse(await readFile(new URL('../examples/observe-example.json', import.meta.url), 'utf8')).mem;
const clone = x => JSON.parse(JSON.stringify(x));
const ov = (mem, turn) => overviewModel(processModel({ mem, turn, agent: mem.agent }));
let n = 0; const ok = m => console.log(`ok ${++n}. ${m}`);
const degradedTurn = turnList(fixture).find(t => agentMsg(fixture, t).degraded);

// 1. A normal turn: three questions, no notice, the recorded proposals and which were selected.
{
  const o = ov(fixture, 1);
  assert.equal(o.notice, null); assert.equal(o.considered.state, 'recorded'); assert.equal(o.considered.selected.length, 2); assert.equal(o.considered.dropped, 3);
  assert.deepEqual(o.inputs.map(i => i.id), ['noticed', 'memories', 'priorities', 'signals', 'selected']);
  assert.match(o.inputs.find(i => i.id === 'selected').value, /2 of 5 proposals were given to the reply step/);
  assert(!JSON.stringify(o).includes(agentMsg(fixture, 1).text), 'the reply itself is not repeated in the overview');
  ok('a normal turn shows its inputs, the selected proposals and no notice, and does not repeat the reply');
}

// 2. Failure kinds are told apart by the stage runner, and only the right ones are retried.
{
  const run = (raw, stop, extra = {}) => runStage(async ({ meta }) => { Object.assign(meta, { stop_reason: stop, usage: { output_tokens: raw ? 5 : 0 } }); if (extra.throws) throw extra.throws; return raw; }, { stage: 'think', max_tokens: 100, schema: SCHEMAS.think, validate: VALIDATORS.think, retries: 1, user: 'x' });
  const refusal = await run('', 'refusal'); assert.equal(refusal.failure.kind, 'refusal'); assert.equal(refusal.attempts.length, 1, 'a refusal is not retried'); assert.match(refusal.failure.detail, /stop_reason "refusal" and 0 output tokens/);
  const malformed = await run('not json at all', 'end_turn'); assert.equal(malformed.failure.kind, 'malformed'); assert.equal(malformed.attempts.length, 2, 'unreadable output is retried once');
  const schema = await run('{"thoughts": []}', 'end_turn'); assert.equal(schema.failure.kind, 'schema'); assert.match(schema.failure.detail, /expected 5 thoughts/);
  const empty = await run('', 'end_turn'); assert.equal(empty.failure.kind, 'empty');
  const cut = await run('', 'max_tokens'); assert.equal(cut.failure.kind, 'truncation');
  const cutJson = await run('{"thoughts": [{"module":', 'max_tokens'); assert.equal(cutJson.failure.kind, 'truncation'); assert(cutJson.attempts[1].max_tokens > cutJson.attempts[0].max_tokens, 'a truncation retry gets more room');
  const transport = await run('', 'end_turn', { throws: Object.assign(new Error('socket hang up'), { kind: 'network' }) }); assert.equal(transport.failure.kind, 'transport');
  const timeout = await run('', 'end_turn', { throws: Object.assign(new Error('slow'), { kind: 'timeout' }) }); assert.equal(timeout.failure.kind, 'timeout');
  const good = await run(JSON.stringify({ thoughts: ['perception', 'memory', 'self-monitor', 'evaluation', 'initiative'].map(module => ({ module, text: 't', relevance: 0.5 })) }), 'end_turn'); assert.equal(good.ok, true);
  assert.equal(new Set([refusal, malformed, schema, empty, cut, transport, timeout].map(r => r.failure.kind)).size, 7, 'seven different failures, seven different kinds');
  ok('refusal, malformed, wrong shape, empty, truncation, transport and timeout are classified separately; only recoverable ones retry');
}

// 3. Each failure kind gets its own sentence in the single notice, and a refusal is not described as unreadable output.
{
  const texts = {};
  for (const kind of Object.keys(FAILURE_WORDS)) {
    const mem = clone(fixture), a = agentMsg(mem, degradedTurn);
    a.monologue.stages.find(s => s.stage === 'think').failure = { kind, detail: 'x' };
    const nt = noticeFor(processModel({ mem, turn: degradedTurn }));
    assert.equal(nt.level, 'warn'); assert(nt.text.includes(FAILURE_WORDS[kind]), `${kind}: ${nt.text}`); assert.match(nt.text, /^No proposals were recorded/); assert.deepEqual(nt.open, { kind: 'node', id: 'proposals' });
    texts[kind] = nt.text;
  }
  assert.match(texts.refusal, /refusal/); assert.doesNotMatch(texts.malformed, /refusal/); assert.equal(new Set(Object.values(texts)).size, Object.keys(texts).length);
  ok('the one notice says why proposals are missing in words that match the actual failure, and links to the details');
}

// 4. A reply after a failed proposal step: incomplete, no invented proposals, no memory changes.
{
  const o = ov(fixture, degradedTurn);
  assert.equal(o.considered.state, 'none'); assert.equal(o.considered.text, 'No proposals were recorded.'); assert(!('selected' in o.considered));
  assert.equal(o.changed.state, 'skipped'); assert.match(o.changed.headline, /incomplete/);
  assert.match(o.inputs.find(i => i.id === 'selected').value, /None\. The reply was written without proposals/);
  assert.equal(o.notice.level, 'warn');
  const full = ov(fixture, 1); assert.equal(full.notice, null, 'only the incomplete turn carries a notice');
  ok('a successful reply after a failed proposal step: "No proposals were recorded", one warning notice, nothing saved to memory');
}

// 5. Saved, unchanged and failed-to-save outcomes from real turns through the real session code.
const dir = await mkdtemp(join(tmpdir(), 'ovw-'));
try {
  const store = makeTalkStore(dir), llm = makeFakeLLM();
  await talkTurn(store, llm, 'A', 'hello there');
  await talkTurn(store, llm, 'A', 'please change how you describe yourself');
  const mem = await store.load('A');
  const plain = ov(mem, 1), changed = ov(mem, 2);
  assert.equal(plain.changed.state, 'unchanged'); assert.equal(plain.changed.headline, 'Nothing was saved or changed after this response.'); assert.match(plain.changed.note, /Only the conversation record was added/);
  assert.equal(changed.changed.state, 'saved'); assert(changed.changed.diffs.length >= 1 && changed.changed.diffs.some(d => d.added.some(x => /My memory is text stored outside me/.test(x))), 'before and after is shown as added and removed lines');
  assert.match(changed.changed.note, /Its own stated reason/);
  assert.equal(changed.notice, null);

  // failed to save: the reply exists, nothing is stored, and the view says exactly that
  const events = [];
  const failing = { ...store, save: async () => { throw new Error('EACCES: permission denied'); } };
  await assert.rejects(() => talkTurn(failing, llm, 'A', 'this one cannot be stored', (s, d) => events.push([s, d])), e => { assert.equal(e.stage, 'save'); assert.equal(e.kind, 'save'); return true; });
  assert(events.some(([s]) => s === 'save_failed'), 'the failure is reported as its own event');
  assert(!events.some(([s]) => s === 'done'), 'a turn that failed to save is never reported as done');
  const after = await store.load('A'); assert.equal(turnList(after).length, 2, 'nothing from the failed turn was stored');
  let live = emptyBrain(); for (const [s, d] of events) live = applyStage(live, s, d);
  const lm = processModel({ mem: after, live }), lo = overviewModel(lm);
  assert.equal(live.saveFailed, true); assert.equal(lm.overall.state, 'save-failed'); assert.equal(lo.changed.state, 'failed'); assert.match(lo.changed.headline, /Saving failed/); assert.equal(lo.notice.level, 'bad');
  assert.equal(lm.nodes.changes.label, 'Saving failed');
  const info = errorInfo(new StageError('save', 'save', 'd', []));
  assert.equal(info.body.stage, 'save');
  ok('saved (before and after), unchanged and failed-to-save are three distinct states, and a failed save is never reported as done');

  // 6. An older turn shows what was recorded then, even after the agent has changed since.
  const earlier = JSON.stringify(ov(mem, 1));
  const later = clone(mem);
  later.selfModel = { beliefs: ['NEWER BELIEF'], uncertainties: [], openQuestions: ['NEWER QUESTION'] };
  later.revisions.push({ turn: 99, at: '9999-01-01T00:00:00.000Z', before: mem.selfModel, after: later.selfModel, note: 'later', trigger: 'x' });
  later.episodes.push({ id: 'm9', kind: 'passage', source: 'Later reading', passage: 1, summary: 'a lighthouse storm story', at: '9999-01-01T00:00:00.000Z' });
  assert.equal(JSON.stringify(ov(later, 1)), earlier, 'later changes do not leak into an earlier turn');
  assert(!JSON.stringify(processModel({ mem: later, turn: 1 })).includes('NEWER'), 'no current self-description in an old turn');
  ok('an older turn is built from its own records: later memory, beliefs and readings never leak in');

  // 7. Two agents never mix.
  await talkTurn(store, llm, 'B', 'a separate question for agent B?');
  const A = await store.load('A'), B = await store.load('B');
  const oa = JSON.stringify(ov(A, 1)), ob = JSON.stringify(ov(B, 1));
  assert(oa.includes('hello there') && !oa.includes('agent B')); assert(ob.includes('separate question for agent B') && !ob.includes('hello there'));
  ok('the overview for agent A never contains agent B records, and the reverse');
} finally { await rm(dir, { recursive: true, force: true }); }

// 8. Memory: retrieved and supplied are different numbers, and "memory off" is its own state.
{
  const mem = freshTalkMemory('A');
  mem.episodes = Array.from({ length: 6 }, (_, i) => ({ id: `m${i + 1}`, kind: 'passage', source: 'Lighthouse', passage: i + 1, summary: `lighthouse storm keeper log entry number ${i + 1}`, at: '2026-01-01T00:00:00.000Z' }));
  const c = buildContext(mem, { query: 'tell me about the lighthouse storm keeper', limits: { maxEpisodes: 2 } });
  assert.equal(c.matched, 6); assert.equal(c.supplied.length, 2); assert.equal(c.omitted, 4);
  const off = buildContext(mem, { mode: 'off', query: 'lighthouse' }); assert.equal(off.supplied.length, 0); assert.equal(off.matched, 0);
  const fx = clone(fixture), a = agentMsg(fx, 1);
  a.monologue.context.speak = { ...a.monologue.context.speak, mode: 'on', available: 6, matched: 6, omitted: 4, supplied: [{ id: 'm1', source: 'Lighthouse', passage: 1, score: 0.5 }, { id: 'm2', source: 'Lighthouse', passage: 2, score: 0.4 }] };
  const row = ov(fx, 1).inputs.find(i => i.id === 'memories');
  assert.match(row.value, /6 matched, 2 supplied \(4 left out by the size limit\)/); assert.match(row.value, /self-description and its note about the person/);
  const legacy = clone(fixture); delete agentMsg(legacy, 1).monologue.context.speak.matched; agentMsg(legacy, 1).monologue.context.speak.supplied = [{ id: 'm1', source: 's', passage: 1, score: 0.1 }];
  assert.match(ov(legacy, 1).inputs.find(i => i.id === 'memories').value, /how many matched was not recorded/);
  const offm = clone(fixture); for (const k of ['think', 'speak']) { agentMsg(offm, 1).monologue.context[k].mode = 'off'; agentMsg(offm, 1).monologue.context[k].supplied = []; }
  assert.match(ov(offm, 1).inputs.find(i => i.id === 'memories').value, /switched off/);
  ok('memories that matched and memories actually supplied are reported separately, with older records saying so honestly');
}

// 9. The proposal prompt no longer asks for a "private thinking stage", and the version says so.
{
  const mem = freshTalkMemory('A'), sys = thinkSystem(mem, freshAffect(), buildContext(mem));
  assert(sys.includes('This is the proposal stage')); assert(!/private thinking/i.test(sys)); assert(/not a record of your inner life/.test(sys));
  assert(sys.includes('"thoughts"'), 'the JSON key is unchanged so stored data and exports keep working');
  assert.equal(PROMPT_VERSION, 'talk-prompts/4');
  ok('the proposal prompt describes working notes for the application, not a private thinking stage; prompt version bumped');
}

// 10. A degraded turn changes nothing in memory (no self-description, no evidence, no self-reports).
{
  const d = await mkdtemp(join(tmpdir(), 'ovw2-'));
  try {
    const store = makeTalkStore(d), llm = makeFakeLLM();
    await talkTurn(store, llm, 'A', 'warm up');
    const before = await store.load('A');
    await talkTurn(store, llm, 'A', '[refuse-think] please change how you describe yourself, I am curious');
    const after = await store.load('A');
    assert.deepEqual(after.selfModel, before.selfModel); assert.equal(after.revisions.length, before.revisions.length); assert.equal(after.personality.log.length, before.personality.log.length); assert.equal(after.selfReports.length, before.selfReports.length);
    assert.equal(agentMsg(after, 2).degraded, true); assert.equal(ov(after, 2).changed.state, 'skipped');
    ok('a reply after a failed proposal step cannot change the self-description, the personality evidence or the self-report log');
  } finally { await rm(d, { recursive: true, force: true }); }
}
console.log(`overview tests passed (${n})`);
