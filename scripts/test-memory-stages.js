// Audit regression tests, part 1: memory delivery and stage failures.
// The point of these tests is the information boundary: what the model REQUEST contained, not what the file holds.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTalkStore, talkTurn, talkSelfTest, freshTalkMemory } from '../src/talk/session.js';
import { runBaseline } from '../src/talk/digest.js';
import { buildContext, contextRecord, DEFAULT_LIMITS } from '../src/talk/context.js';
import { makeRecorder, readRecords } from '../src/lib/records.js';
import { runStage, StageError, CancelledError } from '../src/lib/stage.js';
import { SCHEMAS, VALIDATORS } from '../src/talk/schemas.js';
import { makeNodeLLM } from '../src/agents/transport-node.js';
import { measureProxy, freshPersonality, buildItems } from '../src/talk/personality.js';

const FACT = 'Zorblax-7 recorded every storm at three in the morning';
const THOUGHTS = ['perception', 'memory', 'self-monitor', 'evaluation', 'initiative'].map((module, i) => ({ module, text: `thought about ${module}`, relevance: 0.9 - i * 0.1 }));
const goodThink = JSON.stringify({ thoughts: THOUGHTS });
const goodSpeak = JSON.stringify({ reply: 'Here is my answer.', self_model: null, person_model: null, change_note: 'no change', claims: [], candidate_updates: [] });

// A stub model that records every request it receives and answers by stage.
function makeStub(over = {}) {
  const requests = [];
  const llm = async ({ system, messages, user, meta, stage }) => {
    requests.push({ stage, system, text: (messages || [{ content: user }]).map(m => m.content).join('\n') });
    if (meta) Object.assign(meta, { model: 'stub', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
    if (over[stage]) return over[stage]({ meta, system, messages, user });
    if (stage === 'think') return goodThink;
    if (stage === 'speak') return goodSpeak;
    if (stage === 'personality-questions') return JSON.stringify({ answers: ['a one', 'a two', 'a three', 'a four', 'a five'], updates: [] });
    if (stage === 'selftest-predict') return JSON.stringify({ predicted: 'agree', confidence: 0.5, reason: 'r' });
    if (stage === 'selftest-answer') return JSON.stringify({ stance: 'agree', reason: 'r' });
    return 'Folded.';
  };
  return { llm, requests };
}
const withMemory = async fn => {
  const dir = await mkdtemp(join(tmpdir(), 'mem-'));
  try { return await fn(dir, makeTalkStore(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
};
const episode = (id, summary, extra = {}) => ({ id, kind: 'passage', source: 'Lighthouse Log', passage: 1, summary, excerpt: summary, eventId: null, ...extra });

// ---- 1. memory delivery: the enabled probe receives the fact, the disabled control does not, and the record shows it ----
await withMemory(async (dir, store) => {
  const mem = freshTalkMemory('A');
  mem.episodes = [episode('m1', `${FACT}.`), episode('m2', 'A baker proofed sourdough overnight in a cold kitchen.')];
  mem.personality = freshPersonality();
  await store.save(mem);
  const recorder = makeRecorder(dir);
  const rec = recorder.for('A');
  const question = 'What do you remember about Zorblax-7 and the storms?';
  for (const memory of ['on', 'off']) {
    const { llm, requests } = makeStub();
    // reset the agent between conditions so both start from the same stored state
    await store.save({ ...JSON.parse(JSON.stringify(mem)), turns: 0, active: [], archive: [] });
    await talkTurn(store, recorder.wrapLLM(llm, 'A'), 'A', question, () => {}, rec, { memory });
    const stageReqs = requests.filter(r => r.stage === 'think' || r.stage === 'speak');
    assert.equal(stageReqs.length, 2);
    for (const r of stageReqs) {
      if (memory === 'on') { assert(r.system.includes(FACT), `${r.stage}: enabled probe must receive the learned fact`); assert(r.system.includes('[m1]'), 'the memory id is preserved in the prompt'); assert(!r.system.includes('sourdough'), 'an irrelevant memory is not dumped into the prompt'); }
      else { assert(!r.system.includes(FACT) && !r.system.includes('Zorblax'), `${r.stage}: disabled control must NOT receive the fact`); assert(/switched off/.test(r.system)); }
    }
  }
  await recorder.flush();
  const calls = (await readRecords(dir)).filter(r => r.type === 'model_call' && ['think', 'speak'].includes(r.payload.stage));
  assert.equal(calls.length, 4);
  const on = calls.filter(c => c.payload.context.mode === 'on'), off = calls.filter(c => c.payload.context.mode === 'off');
  assert(on.length === 2 && on.every(c => c.payload.context.supplied.map(s => s.id).join() === 'm1' && c.payload.context.supplied[0].source === 'Lighthouse Log'), 'the record lists exactly which memory ids were supplied, with source');
  assert(off.length === 2 && off.every(c => c.payload.context.supplied.length === 0 && c.payload.context.available === 2), 'the record shows the disabled run had memories available but delivered none');
  assert(on.every(c => c.payload.system.includes(FACT)) && off.every(c => !c.payload.system.includes(FACT)), 'the recorded requests themselves demonstrate the difference');
});

// ---- 2. bounded context, ids and sources kept, traits kept out of the agent prompt ----
{
  const mem = freshTalkMemory('A');
  mem.episodes = Array.from({ length: 80 }, (_, i) => episode(`m${i + 1}`, `Storm note ${i} about the harbor lamp and the tide ${'x'.repeat(200)}`));
  mem.episodes.push({ id: 's1', kind: 'summary', covers: ['m900', 'm901'], source: 'several', passage: 0, summary: 'Folded notes about harbor storms.' });
  const ctx = buildContext(mem, { query: 'harbor storm tide' });
  assert(ctx.supplied.length <= DEFAULT_LIMITS.maxEpisodes && ctx.chars <= DEFAULT_LIMITS.maxChars, 'context is bounded');
  assert(ctx.omitted > 70, 'most of the archive is left out');
  assert(ctx.supplied.every(s => s.id && s.source), 'every supplied memory keeps id and source');
  assert.equal(buildContext(mem, { query: 'zzzz qqqq' }).supplied.length, 0, 'no relevant memory means none is supplied');
  assert.equal(buildContext(mem, { select: 'recent' }).supplied[0].id, 's1', 'recent selection is bounded too, newest first');
  assert.equal(buildContext(mem, { mode: 'off', query: 'harbor' }).supplied.length, 0);
  mem.personality = freshPersonality();
  mem.personality.log.push({ n: 1, eventId: 'e1', id: 'trait:stubborn', kind: 'trait', name: 'stubborn', direction: 'supports', quote: 'q', source: 's', at: 'x' });
  const { thinkSystem, plainSystem } = await import('../src/talk/prompts.js');
  assert(!thinkSystem(mem, { surprise: 0, conflict: 0, curiosity: 0 }, buildContext(mem, { query: 'harbor' })).includes('stubborn'), 'evaluation-only trait annotations stay out of the agent prompt');
  assert(plainSystem(mem, buildContext(mem, { traits: 'in-prompt' })).includes('stubborn'), 'a protocol can test the effect of traits on purpose');
  assert.equal(contextRecord(buildContext(mem, { traits: 'in-prompt' })).traits, 'in-prompt', 'and the choice is recorded');
}

// ---- 3. checkpoint questions can use the reading memories (recency), unlike an unrelated relevance query ----
await withMemory(async (dir, store) => {
  const mem = freshTalkMemory('A');
  mem.episodes = [episode('m1', `${FACT}.`)];
  await store.save(mem);
  const { llm, requests } = makeStub();
  await runBaseline(store, llm, 'A', () => {}, { keepMemory: true });
  assert(requests.find(r => r.stage === 'personality-questions').system.includes(FACT), 'checkpoint questions receive the reading memory');
  const off = makeStub();
  await runBaseline(store, off.llm, 'A', () => {}, { keepMemory: true, memory: 'off' });
  assert(!off.requests.find(r => r.stage === 'personality-questions').system.includes(FACT), 'and not when memory is off');
});

// ---- 4. stage validation and failure kinds ----
{
  const mk = (raw, stop = 'end_turn') => async ({ meta }) => { Object.assign(meta, { stop_reason: stop }); return raw; };
  const spec = (over = {}) => ({ stage: 'think', system: 's', user: 'u', schema: SCHEMAS.think, validate: VALIDATORS.think, retries: 1, ...over });
  const kinds = {};
  kinds.ok = await runStage(mk(goodThink), spec());
  assert(kinds.ok.ok && kinds.ok.attempts.length === 1);
  kinds.refusal = await runStage(mk('', 'refusal'), spec());
  assert.equal(kinds.refusal.failure.kind, 'refusal'); assert.equal(kinds.refusal.attempts.length, 1, 'a refusal is not retried');
  kinds.truncation = await runStage(mk('{"thoughts": [{"module": "perc', 'max_tokens'), spec());
  assert.equal(kinds.truncation.failure.kind, 'truncation'); assert.equal(kinds.truncation.attempts.length, 2, 'truncation gets exactly one bounded retry');
  assert(kinds.truncation.attempts[1].max_tokens > kinds.truncation.attempts[0].max_tokens, 'the retry allows more tokens');
  kinds.malformed = await runStage(mk('sorry, here you go'), spec());
  assert.equal(kinds.malformed.failure.kind, 'malformed');
  kinds.schema = await runStage(mk(JSON.stringify({ thoughts: THOUGHTS.slice(0, 4) })), spec());
  assert.equal(kinds.schema.failure.kind, 'schema'); assert(/expected 5/.test(kinds.schema.failure.detail));
  kinds.empty = await runStage(mk('', 'end_turn'), spec());
  assert.equal(kinds.empty.failure.kind, 'empty');
  kinds.transport = await runStage(async () => { throw new Error('socket hang up'); }, spec({ retries: 0 }));
  assert.equal(kinds.transport.failure.kind, 'transport');
  assert(Object.values(kinds).filter(r => !r.ok).every(r => r.attempts.every(a => 'raw' in a && 'kind' in a)), 'raw output and diagnostics are preserved for every attempt');
  // five-role protocol rules
  const think = o => VALIDATORS.think({ thoughts: o });
  assert.equal(think(THOUGHTS), null);
  assert(/duplicate/.test(think([...THOUGHTS.slice(0, 4), { ...THOUGHTS[0] }])));
  assert(/unrecognized/.test(think([...THOUGHTS.slice(0, 4), { module: 'dreaming', text: 't', relevance: 0.5 }])));
  assert(/relevance/.test(think([...THOUGHTS.slice(0, 4), { module: 'initiative', text: 't', relevance: 7 }])));
  assert(/relevance/.test(think([...THOUGHTS.slice(0, 4), { module: 'initiative', text: 't', relevance: NaN }])));
  assert(/text/.test(think([...THOUGHTS.slice(0, 4), { module: 'initiative', text: '  ', relevance: 0.5 }])));
  // cancellation: the stage stops and makes no further model calls
  const ac = new AbortController(); let calls = 0;
  const slow = async () => { calls++; ac.abort(); return 'unusable'; };
  await assert.rejects(() => runStage(slow, spec({ signal: ac.signal, retries: 3 })), CancelledError);
  assert.equal(calls, 1);
}

// ---- 5. a failed THINK is visible, labelled degraded, and excluded from analysis ----
await withMemory(async (dir, store) => {
  const refusal = makeStub({ think: async ({ meta }) => { meta.stop_reason = 'refusal'; return ''; } });
  const events = [];
  const out = await talkTurn(store, refusal.llm, 'A', 'Hello there.', (s, d) => events.push([s, d]), () => {});
  assert.equal(out.turn.status, 'degraded');
  assert.equal(out.turn.degraded[0].stage, 'think'); assert.equal(out.turn.degraded[0].kind, 'refusal');
  const th = events.find(e => e[0] === 'thoughts')[1];
  assert.equal(th.status, 'failed'); assert.equal(th.failure.kind, 'refusal'); assert.equal(th.candidates.length, 0);
  assert(out.turn.flags.some(f => f.check === 'thinking-incomplete'), 'the failure is flagged');
  assert(refusal.requests.filter(r => r.stage === 'think').length === 1, 'refusals are not retried');
  assert(/no workspace thoughts/.test(refusal.requests.find(r => r.stage === 'speak').system), 'the speaker is told it has no workspace, so it cannot pretend to have deliberated');
  const m = await store.load('A');
  assert.equal(m.archive.at(-1).degraded, true);
  assert.equal(measureProxy('questions', m.archive).n, 0, 'degraded turns are excluded from behavior measures');
  assert.equal(buildItems(m.personality).length, 0);
});
// SPEAK failing fails the turn: nothing is saved and the error names the stage
await withMemory(async (dir, store) => {
  const bad = makeStub({ speak: async () => 'nope' });
  await assert.rejects(() => talkTurn(store, bad.llm, 'A', 'Hi', () => {}, () => {}), e => e instanceof StageError && e.stage === 'speak');
  assert.equal((await store.load('A')).turns, 0, 'no turn was recorded');
});
// cancellation during a turn stops further calls and records the final state
await withMemory(async (dir, store) => {
  const ac = new AbortController(); const { llm, requests } = makeStub({ think: async () => { ac.abort(); return goodThink; } });
  const logged = [];
  await assert.rejects(() => talkTurn(store, llm, 'A', 'Hi', () => {}, (t, p) => logged.push(t), { signal: ac.signal }), CancelledError);
  assert(!requests.some(r => r.stage === 'speak'), 'no speak call after cancellation');
  assert(logged.includes('turn_cancelled'), 'the final state is recorded');
  assert.equal((await store.load('A')).turns, 0);
});

// ---- 6. unreadable self-test answers are INVALID, not wrong ----
await withMemory(async (dir, store) => {
  const { llm } = makeStub({ 'selftest-answer': async () => 'cannot say' });
  const { test } = await talkSelfTest(store, llm, 'A', 'A statement worth testing.', () => {});
  assert.equal(test.match, 'invalid'); assert.equal(test.invalid, true); assert(/answer 1 unreadable/.test(test.invalidReason));
  const ok = await talkSelfTest(store, makeStub().llm, 'A', 'Another statement to test.', () => {});
  assert.equal(ok.test.match, 'yes');
  const { METRICS } = await import('../src/research/metrics.js');
  const mems = { A: await store.load('A') };
  const acc = METRICS.selfpredict_accuracy.compute(mems, 'A');
  assert.deepEqual([acc.value, acc.n], [1, 1], 'the invalid test is excluded from the denominator');
  assert.equal(acc.invalid, 1, 'and the invalid count is reported');
});

// ---- 7. transport: timeout, bounded retry with backoff, cancellation, structured output ----
{
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => '', headers: new Map() });
  const fail = (status, text = 'x') => ({ ok: false, status, text: async () => text, headers: { get: () => null } });
  const body = { model: 'm', stop_reason: 'end_turn', usage: { input_tokens: 1 }, content: [{ type: 'text', text: 'hi' }] };
  const mkLLM = (seq, extra = {}) => { let i = 0; const calls = []; const f = async (url, init) => { calls.push(JSON.parse(init.body)); const r = seq[Math.min(i++, seq.length - 1)]; if (typeof r === 'function') return r(init); return r; }; return { llm: makeNodeLLM({ apiKey: 'k', model: 'm', fetchImpl: f, backoffMs: 1, timeoutMs: 40, log: () => {}, ...extra }), calls }; };
  { const { llm, calls } = mkLLM([fail(529), fail(429), ok(body)]); const meta = {}; assert.equal(await llm({ system: 's', user: 'u', meta }), 'hi'); assert.equal(calls.length, 3); assert.equal(meta.retries, 2); }
  { const { llm, calls } = mkLLM([fail(503)], { maxRetries: 2 }); await assert.rejects(() => llm({ system: 's', user: 'u' }), /503/); assert.equal(calls.length, 3, 'retries are bounded'); }
  { const { llm, calls } = mkLLM([fail(401, 'bad key')]); await assert.rejects(() => llm({ system: 's', user: 'u' }), /401/); assert.equal(calls.length, 1, 'a non-transient error is not retried'); }
  { const { llm } = mkLLM([init => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))], { maxRetries: 0 }); await assert.rejects(() => llm({ system: 's', user: 'u' }), e => e.kind === 'timeout'); }
  { const ac = new AbortController(); const { llm, calls } = mkLLM([fail(503)], { backoffMs: 200 }); const p = llm({ system: 's', user: 'u', signal: ac.signal }); setTimeout(() => ac.abort(), 20); await assert.rejects(() => p, CancelledError); assert.equal(calls.length, 1, 'cancelling during backoff stops further requests'); }
  { const { llm, calls } = mkLLM([ok(body)]); await llm({ system: 's', user: 'u', schema: SCHEMAS.answer }); assert.equal(calls[0].output_config.format.type, 'json_schema', 'structured output uses output_config.format'); assert.equal(calls[0].output_format, undefined, 'not the deprecated parameter'); }
  { const { llm, calls } = mkLLM([fail(400, 'output_config.format is not supported for this model'), ok(body)]); assert.equal(await llm({ system: 's', user: 'u', schema: SCHEMAS.answer }), 'hi'); assert.equal(calls.length, 2); assert.equal(calls[1].output_config, undefined, 'falls back to prompt-only JSON if the model rejects structured output'); }
}

// ---- 8. recorder failures are visible ----
await withMemory(async dir => {
  const errors = [];
  const bad = makeRecorder(join(dir, 'a-file-not-a-folder.txt', 'x'), { onFailure: e => errors.push(e.message) });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, 'a-file-not-a-folder.txt'), 'blocker');
  bad.log('turn', 'A', { x: 1 });
  await bad.flush();
  assert(errors.length >= 1, 'the failure is reported, not swallowed');
  const h = bad.health();
  assert.equal(h.ok, false); assert(h.pending >= 1, 'the unwritten record is kept in the queue'); assert(h.lastError);
});

console.log('memory delivery and stage failures ok');
