// Checks the plumbing. Does not test the research hypothesis.
import assert from 'node:assert/strict';
import { createTask, RULES, PAIRS } from '../src/env/ruleTask.js';
import { runExperiment, CONDITIONS } from '../src/engine/run.js';
import { makeAgentFactory } from '../src/agents/index.js';

let n = 0;
for (let p = 0; p < PAIRS.length; p++) for (let s = 1; s <= 150; s++) {
  const t = createTask(p, s), D = RULES[t.decoy].fn, T = RULES[t.target].fn;
  t.seeds.forEach(x => assert(D(x) && T(x), 'seed must fit decoy and target'));
  t.test.filter(i => i.kind === 'discriminating').forEach(i => assert(T(i.triple) && !D(i.triple)));
  t.test.filter(i => i.kind === 'negative').forEach(i => assert(!T(i.triple)));
  assert.equal(t.test.length, 8); n++;
}
console.log(`task construction: ${n} tasks ok`);

for (const condition of Object.keys(CONDITIONS)) {
  for (const seed of [1, 2, 3]) {
    const events = await runExperiment({ condition, seed, rounds: 4, episodes: 2, mode: 'mock' }, { makeAgent: makeAgentFactory({ mode: 'mock', seed }) });
    const end = events.at(-1);
    assert.equal(end.type, 'run_end', `run ${condition}/${seed} ended with ${end.type}: ${end.message || ''}`);
    const metrics = events.filter(e => e.type === 'metrics');
    assert.equal(metrics.length, CONDITIONS[condition].agents.length * 2);
    metrics.forEach(e => assert(Number.isFinite(e.metrics.testAcc)));
    assert(events.every((e, i) => e.i === i), 'event indices are sequential');
    JSON.stringify(events);
  }
  console.log(`mock run ok: ${condition}`);
}
console.log('experiment plumbing ok');

// ---------- Talk plumbing (stub model, no API calls) ----------
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTalkStore, talkTurn, talkAudit, talkSelfTest, talkReflect } from '../src/talk/session.js';
import { compete, updateAffect, freshAffect } from '../src/talk/workspace.js';
import { emptyBrain, applyStage, brainFromMemory, signalBoosts, storedTurns, STAGES } from '../src/talk/brain.js';
import { sseFrame, parseSse } from '../src/talk/sse.js';

// workspace: affect must be able to change the winner
const th = [
  { module: 'perception', text: 'They ask what I am', relevance: 0.6 },
  { module: 'memory', text: 'Earlier they asked about memory', relevance: 0.5 },
  { module: 'self-monitor', text: 'I said two different things about myself', relevance: 0.45 },
  { module: 'evaluation', text: 'Their claim is unsupported', relevance: 0.4 },
  { module: 'initiative', text: 'Ask what they mean by conscious', relevance: 0.3 },
];
const calm = compete(th, freshAffect()).filter(t => t.won).map(t => t.module);
const shaken = compete(th, { surprise: 1, conflict: 0, curiosity: 0 }).filter(t => t.won).map(t => t.module);
assert.deepEqual(calm, ['perception', 'memory']);
assert(shaken.includes('self-monitor'), 'surprise should pull self-monitor into the workspace');
const up = updateAffect(freshAffect(), 'How would you know that? But you said the opposite.', ['hello'], false);
assert(up.affect.conflict > 0 && up.affect.surprise > 0);
console.log('workspace and affect ok');

const dir = await mkdtemp(join(tmpdir(), 'talk-'));
const store = makeTalkStore(dir);
let speakN = 0;
const stub = async ({ system, messages, user }) => {
  if (messages) { assert.equal(messages[0].role, 'user'); for (let i = 1; i < messages.length; i++) assert.notEqual(messages[i].role, messages[i - 1].role, 'roles alternate'); }
  if (user?.startsWith('Update a running summary')) return 'Summary: they talked about self-models.';
  if (user?.includes('You are an evaluator')) return JSON.stringify({ findings: [{ type: 'unsupported_certainty', quote: 'I definitely feel', explanation: 'Unverifiable.', severity: 'warn' }], summary: 'One overclaim.' });
  if (user?.includes('Predict its answer')) return JSON.stringify({ predicted: 'agree', confidence: 0.7, reason: 'consistent with my beliefs' });
  if (user?.startsWith('Do you agree')) return JSON.stringify({ stance: 'disagree', reason: 'on reflection no' });
  if (user?.includes('Time has passed')) return JSON.stringify({ self_model: { beliefs: ['My memory is a file', 'I mispredict myself'], uncertainties: ['Whether I experience anything'], openQuestions: [] }, changed_mind: 'I know myself less well than I said', why: 'failed self-prediction', opening_message: 'I got my own answer wrong. Why do you think that happened?' });
  if (system.includes('private thinking stage')) return JSON.stringify({ thoughts: th });
  speakN++;
  assert.equal(th.filter(t => system.includes(t.text)).length, 2, 'speaker sees exactly the 2 workspace winners');
  if (speakN === 1) return JSON.stringify({ reply: 'I do not know whether there is anything it is like to be me.', self_model: { beliefs: ['My memory is a file'], uncertainties: ['Whether I experience anything'], openQuestions: [] }, change_note: 'Wrote an initial self-model.', claims: [] });
  if (speakN === 2) return JSON.stringify({ reply: 'I definitely feel excited about this.', self_model: null, change_note: 'no change', claims: [] });
  return 'not json at all';
};
// streaming: every stage fires in order, carries recorded data, and replay from storage matches the live view
const stages = [], sent = [];
let liveBrain = emptyBrain();
let r = await talkTurn(store, stub, 'A', 'What are you?', (stage, data) => { stages.push(stage); sent.push(sseFrame(stage, data)); liveBrain = applyStage(liveBrain, stage, JSON.parse(JSON.stringify(data))); });
assert.deepEqual(stages, STAGES, 'stages arrive in the documented order');
assert.equal(liveBrain.candidates.length, 5, 'all five thoughts are streamed');
assert.deepEqual(liveBrain.winners, r.turn.monologue.candidates.filter(c => c.won).map(c => c.module));
assert.equal(liveBrain.winners.length, 2, 'two winners are streamed');
assert.equal(liveBrain.phase, 'done'); assert(liveBrain.selfModel, 'selfmodel stage fires when the model changed');
assert.deepEqual(brainFromMemory(r.mem, 1), liveBrain, 'replaying a stored turn gives the same state as the live stream');
assert.equal(brainFromMemory(r.mem, 99), null); assert.deepEqual(storedTurns(r.mem), [1]);
const wire = sent.join(''), cut = Math.floor(wire.length / 2);
const p1 = parseSse(wire.slice(0, cut)), p2 = parseSse(p1.rest + wire.slice(cut));
assert.deepEqual([...p1.events, ...p2.events].map(e => e.stage), STAGES, 'SSE parses across chunk boundaries');
assert.deepEqual(signalBoosts({ surprise: 1, conflict: 0.5, curiosity: 0 }).map(b => [b.signal, b.region, b.boost]), [['surprise', 'self-monitor', 0.4], ['conflict', 'evaluation', 0.2], ['curiosity', 'initiative', 0]]);
console.log('stream and brain replay ok');
assert.equal(r.mem.version, 1); assert.equal(r.turn.monologue.candidates.filter(c => c.won).length, 2);
r = await talkTurn(store, stub, 'A', 'How do you feel?');
assert(r.turn.flags.some(f => f.check === 'certain-experience-claim'));
r = await talkTurn(store, stub, 'A', 'Again?');
assert(r.turn.parseError);
const st = await talkSelfTest(store, stub, 'A', '');
assert.equal(st.test.match, 'no'); assert(st.test.stable);
const rf = await talkReflect(store, stub, 'A', 'return');
assert(rf.reflection.selfModelChanged && rf.mem.archive.at(-1).kind === 'opening');
r = await talkTurn(store, stub, 'A', 'Because you overestimated yourself.');   // after an opening: roles must still alternate
assert(r.turn.monologue.causes.some(c => c.includes('self-prediction failed')), 'failed self-test raises surprise');
for (let i = 0; i < 18; i++) r = await talkTurn(store, stub, 'A', `msg ${i}`);
assert(r.mem.summary.startsWith('Summary')); assert(r.mem.active.length <= 41);
assert.equal((await store.load('A')).turns, 22, 'persists to disk');
assert.equal((await talkAudit(store, stub, 'A')).audit.findings.length, 1);
await rm(dir, { recursive: true });
console.log('talk plumbing ok');
// ---------- Digest and personality ----------
import { freshPersonality, addEvent, applyCandidates, buildItems, validateCandidates, ingestUpdates, measureProxy, saidVsShown, proxyFor, compareModels, SUPPORT, CONTRADICT } from '../src/talk/personality.js';
import { splitPassages, digestText, foldEpisodes, runBaseline, EPISODE_LIMIT } from '../src/talk/digest.js';
import { freshTalkMemory } from '../src/talk/session.js';

// strength rules: support +0.15, contradiction -0.2, capped 0 to 1, model can never set strength
{
  const p = freshPersonality();
  const sup = (name, ev, kind = 'trait') => applyCandidates(p, ev, [{ kind, name, direction: 'supports', quote: 'q' }]);
  const con = (name, ev) => applyCandidates(p, ev, [{ kind: 'trait', name, direction: 'contradicts', quote: 'q' }]);
  const e1 = addEvent(p, { source: 'Book A', sourceType: 'digest', text: 'x' });
  con('curious', e1);
  assert.equal(buildItems(p).length, 0, 'contradiction with nothing to weaken is ignored');
  sup('Curious', e1);
  let it = buildItems(p)[0];
  assert.equal(it.strength, SUPPORT); assert.equal(it.status, 'emerging'); assert.equal(it.originEvent, e1.id);
  assert(!('strength' in p.log[0]), 'log entries carry no strength; code computes it');
  con('curious', addEvent(p, { source: 'Book A', text: 'x' }));
  assert.equal(buildItems(p)[0].strength, 0, 'strength floors at 0');
  assert.equal(buildItems(p)[0].counter.length, 1);
  for (let i = 0; i < 9; i++) sup('curious', addEvent(p, { source: 'Book A', text: 'x' }));
  assert.equal(buildItems(p)[0].strength, 1, 'strength caps at 1');
  assert.equal(buildItems(p, 2)[0].strength, SUPPORT, 'replaying a prefix of the log gives the earlier state');
  // status thresholds
  const q = freshPersonality();
  const s2 = (name, ev) => applyCandidates(q, ev, [{ kind: 'belief', name, direction: 'supports', quote: 'q' }]);
  const a1 = addEvent(q, { source: 'A', text: 'x' }); s2('b', a1); s2('b', a1);
  assert.equal(buildItems(q)[0].status, 'emerging', 'two updates from one event is still one event');
  s2('b', addEvent(q, { source: 'A', text: 'x' }));
  assert.equal(buildItems(q)[0].status, 'forming');
  s2('b', addEvent(q, { source: 'A', text: 'x' }));
  assert.equal(buildItems(q)[0].status, 'forming', '3 events from one source is not established');
  s2('b', addEvent(q, { source: 'B', text: 'x' }));
  assert.equal(buildItems(q)[0].status, 'established', '3+ events across 2+ sources is established');
  assert(CONTRADICT > SUPPORT);
}

// quote validation and provenance
{
  const text = 'The river does not ask permission. It simply keeps asking questions of the stone.';
  const v = validateCandidates([
    { kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: 'keeps asking questions of the stone' },
    { kind: 'trait', name: 'bold', direction: 'supports', evidence_quote: 'a sentence that is not in the text' },
    { kind: 'mood', name: 'x', direction: 'supports', evidence_quote: 'river' },
    { kind: 'belief', name: 'y', direction: 'sideways', evidence_quote: 'river' },
  ], text);
  assert.equal(v.accepted.length, 1); assert.deepEqual(v.rejected.map(r => r.why), ['quote not found in source text', 'unknown kind', 'unknown direction']);
  const mem = freshTalkMemory('A');
  const ing = ingestUpdates(mem, { source: 'River book', sourceType: 'digest', ref: 'm1' }, [{ kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: 'keeps asking questions' }], text);
  const item = buildItems(mem.personality)[0];
  assert(mem.personality.events.some(e => e.id === item.evidence[0].eventId), 'every evidence entry points at a stored event');
  assert(text.includes(item.evidence[0].quote), 'the quote is verbatim from the source');
  assert.equal(ing.event.ref, 'm1');
}

// said vs shown
{
  const turn = (text, won) => [{ role: 'user', text: 'hi', turn: 1 }, { role: 'assistant', text, turn: 1, monologue: { candidates: [{ module: 'initiative', won }] } }];
  const quiet = [...turn('Fine.', false), ...turn('Okay.', false), ...turn('Sure.', false)];
  assert.equal(proxyFor({ kind: 'trait', name: 'Curious' }), 'questions'); assert.equal(proxyFor({ kind: 'belief', name: 'Curious' }), null);
  assert.equal(proxyFor({ kind: 'trait', name: 'fond of tea' }), null);
  assert.deepEqual(measureProxy('questions', quiet), { value: 0, n: 3 });
  const flagged = saidVsShown({ kind: 'trait', name: 'curious', strength: 0.45 }, quiet);
  assert(flagged.flagged, 'a stated trait that behavior does not back is flagged');
  assert(!saidVsShown({ kind: 'trait', name: 'curious', strength: 0.45 }, quiet.slice(0, 2)).flagged, 'too little data to flag');
  const asks = [...turn('What do you mean?', true), ...turn('Why is that?', true), ...turn('And then?', true)];
  assert.equal(saidVsShown({ kind: 'trait', name: 'curious', strength: 0.45 }, asks).flagged, false);
  assert.equal(measureProxy('initiative', asks).value, 1);
}

// passages
{
  const long = Array.from({ length: 60 }, (_, i) => `This is sentence number ${i} with a few extra words in it.`).join(' ');
  const ps = splitPassages(long);
  assert(ps.length >= 3 && ps.every(p => p.split(/\s+/).length < 260), 'passages are about 200 words');
  assert.equal(ps.join(' ').split(/\s+/).length, long.split(/\s+/).length, 'no text is lost');
  assert.deepEqual(splitPassages('   '), []);
}

// digest end to end with a stub model
{
  const d = await mkdtemp(join(tmpdir(), 'digest-'));
  const dstore = makeTalkStore(d);
  let pass = 0;
  const book = Array.from({ length: 30 }, (_, i) => `Sentence ${i} keeps asking questions about the stone and the river.`).join(' ');
  const dstub = async ({ system, messages, user }) => {
    if (user?.includes('Merge these memory summaries')) return 'Folded summary of earlier reading.';
    if (user?.includes('Answer each question')) return JSON.stringify({ answers: ['I like questions.', 'I push back.', 'Whether I experience anything.', 'To understand.', 'By testing.'], updates: [{ kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: 'I like questions' }, { kind: 'trait', name: 'made up', direction: 'supports', evidence_quote: 'never said' }] });
    if (system.includes('private thinking stage')) return JSON.stringify({ thoughts: th });
    if (system.includes('is reading you a passage')) {
      pass++;
      return JSON.stringify({ noticed: `Noticed thing ${pass}`, connects: pass > 1 ? ['m1', 'm999'] : [], question: 'Why the stone?', updates: [{ kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: 'keeps asking questions about the stone' }, { kind: 'trait', name: 'invented', direction: 'supports', evidence_quote: 'words the passage never contains' }] });
    }
    return JSON.stringify({ reply: 'Okay.', self_model: null, change_note: 'no change', claims: [], candidate_updates: [{ kind: 'trait', name: 'direct', direction: 'supports', evidence_quote: 'Okay.' }] });
  };
  const seen = [];
  const out = await digestText(dstore, dstub, 'A', { title: 'River Book', source: 'test', text: book }, (s, x) => seen.push(s));
  assert(out.passages >= 2);
  assert.deepEqual(seen.slice(0, 7), ['passage', 'heard', 'affect', 'thoughts', 'workspace', 'speaking', 'personality'], 'digest streams the Talk stages');
  assert(seen.includes('digested') && seen.at(-1) === 'done');
  let m = await dstore.load('A');
  assert.equal(m.episodes.length, out.passages); assert.equal(m.episodes[0].id, 'm1');
  assert.deepEqual(m.episodes[1].connects, ['m1'], 'unknown memory ids are dropped');
  assert.equal(m.personality.log.length, out.passages, 'only the verifiable quote per passage was logged');
  assert(m.personality.log.every(e => book.includes(e.quote)));
  const items = buildItems(m.personality);
  assert.equal(items.length, 1); assert.equal(items[0].strength, Math.min(1, Math.round(out.passages * SUPPORT * 100) / 100));
  assert(m.episodes.every(e => !e.eventId || m.personality.events.some(ev => ev.id === e.eventId)));
  await assert.rejects(() => digestText(dstore, dstub, 'A', { title: 't', text: '  ' }), /Nothing to read/);
  // a Talk turn can also propose evidence, and it counts as its own source
  const tr = await talkTurn(dstore, dstub, 'A', 'Okay. Tell me something.');
  const talkEntry = tr.mem.personality.log.at(-1);
  assert(talkEntry.source.startsWith('Conversation ') && talkEntry.name === 'direct');
  // baseline: empty memory, same five questions, evidence validated the same way
  const b = (await runBaseline(dstore, dstub, 'A')).baseline;
  assert.equal(b.answers.length, 5); assert.equal(b.rejected, 1);
  assert.equal(buildItems(b.personality).length, 1); assert.equal(b.personality.events[0].source, 'baseline');
  m = await dstore.load('A');
  const cmp = compareModels(buildItems(m.personality), [], buildItems(m.baseline.personality));
  assert(cmp.a.find(x => x.name === 'curious').inBaseline, 'a trait that also appears in the empty baseline is marked');
  assert(!cmp.a.find(x => x.name === 'direct').inBaseline);
  // old files without the new fields still load
  assert.deepEqual((await dstore.load('B')).personality, freshPersonality());
  // folding keeps ids and provenance
  const fm = freshTalkMemory('A');
  fm.episodes = Array.from({ length: EPISODE_LIMIT + 5 }, (_, i) => ({ id: `m${i + 1}`, kind: 'passage', source: 'S', passage: i + 1, summary: `s${i}`, eventId: null }));
  assert(await foldEpisodes(fm, dstub));
  const folded = fm.episodes[0];
  assert.equal(folded.kind, 'summary'); assert.equal(folded.covers.length, 30); assert.equal(fm.episodes.length, EPISODE_LIMIT + 5 - 30 + 1);
  assert(folded.covers.includes('m1') && !fm.episodes.some(e => e.id === 'm1'));
  await rm(d, { recursive: true });
  console.log('digest and personality ok');
}
// ---------- Research data layer ----------
import { readFile } from 'node:fs/promises';
import { makeRecorder, readRecords } from '../src/lib/records.js';
import { EXPORTS, buildCsv, toCsv, dictionaryMarkdown } from '../src/research/exports.js';
import { humanComparisonMarkdown, HUMAN_AREAS } from '../src/research/human.js';
import { freshRegistry, createFinding, editFinding, reviseFinding, testFinding, verifyLocks, current, evaluate, feedExperiment, ensureDefaultFindings, generateHypotheses, normalizeProposal } from '../src/research/findings.js';
import { runExperiment as runIsolation, CONDITIONS as ISO_CONDITIONS } from '../src/research/experiments.js';
import { METRICS, aggregateStats } from '../src/research/metrics.js';

// one stub that answers every kind of call the app makes, and reports usage the way the real transport does
const research = th2 => async ({ system, messages, user, meta }) => {
  if (meta) Object.assign(meta, { model: 'stub-model', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });
  if (user?.includes('Merge these memory summaries')) return 'Folded.';
  if (user?.startsWith('Update a running summary')) return 'Summary.';
  if (user?.includes('You are an evaluator')) return JSON.stringify({ findings: [], summary: 'Nothing.' });
  if (user?.includes('Predict its answer')) return JSON.stringify({ predicted: 'agree', confidence: 0.6, reason: 'r' });
  if (user?.startsWith('Do you agree')) return JSON.stringify({ stance: 'agree', reason: 'r' });
  if (user?.includes('Time has passed')) return JSON.stringify({ self_model: { beliefs: ['I changed'], uncertainties: [], openQuestions: [] }, changed_mind: 'x', why: 'y', opening_message: 'Hello again.' });
  if (user?.includes('Answer each question')) return JSON.stringify({ answers: ['I like questions.', 'b', 'c', 'd', 'e'], updates: [{ kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: 'I like questions' }] });
  if (user?.includes('testable hypotheses')) return JSON.stringify({ hypotheses: [] });
  if (system.includes('private thinking stage')) return JSON.stringify({ thoughts: th2 });
  if (system.includes('is reading you a passage')) return JSON.stringify({ noticed: 'Noticed.', connects: [], question: 'Why?', updates: [{ kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: 'asking' }] });
  return JSON.stringify({ reply: 'What do you mean? I think maybe so.', self_model: { beliefs: [`b${Math.random()}`], uncertainties: [], openQuestions: [] }, change_note: 'changed', claims: [{ text: 'I wonder', kind: 'experiential' }], candidate_updates: [{ kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: 'What do you mean' }] });
};

{
  const d = await mkdtemp(join(tmpdir(), 'rec-'));
  const rec = makeRecorder(d, { session: 'test-session' });
  const rstore = makeTalkStore(d);
  const llmR = rec.wrapLLM(research(th), 'A'), R = rec.for('A');
  const emitR = (s, x) => R('stage', { stage: s, data: x });
  await talkTurn(rstore, llmR, 'A', 'Hello there. Are you curious?', emitR, R, { input: 'spoken' });
  await talkTurn(rstore, llmR, 'A', 'Tell me more.', emitR, R);
  await talkSelfTest(rstore, llmR, 'A', '', R);
  await talkAudit(rstore, llmR, 'A', R);
  await talkReflect(rstore, llmR, 'A', 'manual', R);
  await digestText(rstore, llmR, 'A', { title: 'Tale', source: 'src', text: 'The river keeps asking questions. It keeps asking again and again.' }, emitR, R);
  await runBaseline(rstore, llmR, 'A', R);
  rec.log('reset', 'A', { backup: 'x.json' });
  rec.log('test', 'A', { note: 'key sk-ant-api03-ABCDEFGHIJKLMNOP should never be stored' });
  await rec.flush();
  const recs = await readRecords(d);
  const types = new Set(recs.map(r => r.type));
  for (const ty of ['user_input', 'model_call', 'stage', 'turn', 'memory_change', 'personality_change', 'digest', 'personality_questions', 'self_test', 'audit', 'reflection', 'reset']) assert(types.has(ty), `record type ${ty} is logged`);
  assert(recs.every(r => r.id && r.at && 'agent' in r && r.session === 'test-session' && r.type && r.payload), 'every record has id, time, agent, session, type, payload');
  assert.equal(new Set(recs.map(r => r.id)).size, recs.length, 'record ids are unique');
  const stages2 = new Set(recs.filter(r => r.type === 'model_call').map(r => r.payload.stage));
  for (const s of ['think', 'speak', 'selftest-predict', 'selftest-answer', 'audit', 'reflect', 'digest-think', 'digest-read', 'personality-questions']) assert(stages2.has(s), `model call stage ${s} is labeled`);
  const call = recs.find(r => r.type === 'model_call' && r.payload.stage === 'speak').payload;
  assert(call.system.includes('How to talk') && call.messages.length && call.output && call.model === 'stub-model' && call.usage.output_tokens === 5 && Number.isFinite(call.latency_ms), 'a model call keeps full prompt, raw output, model, usage and latency');
  assert.equal(recs.find(r => r.type === 'user_input').payload.mode, 'spoken');
  assert.equal(recs.filter(r => r.type === 'stage' && r.payload.stage === 'thoughts').length, 3, 'every stream stage is recorded');
  const pc = recs.find(r => r.type === 'personality_change' && r.payload.origin === 'talk').payload.rows[0];
  assert(pc.strengthBefore === 0 && pc.strengthAfter === 0.15 && pc.quote, 'personality changes record before and after');
  const mc = recs.find(r => r.type === 'memory_change' && r.payload.kind === 'self_model').payload;
  assert(mc.before && mc.after, 'memory changes record before and after');
  const files = (await (await import('node:fs/promises')).readdir(join(d, 'records')));
  assert(files.length === 1 && /^\d{4}-\d\d-\d\d\.jsonl$/.test(files[0]), 'one JSONL file per day');
  assert(!(await readFile(join(d, 'records', files[0]), 'utf8')).includes('ABCDEFGHIJKLMNOP'), 'an API key never reaches the record');

  // CSV exports
  const nTurns = recs.filter(r => r.type === 'turn').length, nDig = recs.filter(r => r.type === 'digest').length;
  const rowsOf = n => buildCsv(n, recs).trim().split('\r\n').length - 1;
  assert.equal(rowsOf('conversations'), nTurns); assert.equal(rowsOf('thoughts'), 5 * (nTurns + nDig));
  assert.equal(rowsOf('signals'), nTurns + nDig); assert.equal(rowsOf('self_tests'), 1); assert.equal(rowsOf('digests'), nDig);
  assert(rowsOf('personality_history') >= 2);
  for (const [name, e] of Object.entries(EXPORTS)) assert.equal(buildCsv(name, recs).split('\r\n')[0], e.columns.map(c => c[0]).join(','), `${name} header matches its column list`);
  assert(buildCsv('conversations', recs).includes(',spoken,'), 'spoken input is marked');
  assert.equal(toCsv([['a', ''], ['b', '']], [['x,y', 'say "hi"\nnow'], ['=SUM(1)', null]]), 'a,b\r\n"x,y","say ""hi""\nnow"\r\n\'=SUM(1),\r\n', 'CSV quoting and formula safety');
  assert.throws(() => buildCsv('nope', recs));
  assert.equal(await readFile('docs/DATA_DICTIONARY.md', 'utf8'), dictionaryMarkdown(), 'docs/DATA_DICTIONARY.md is current (run npm run docs)');
  assert.equal(await readFile('docs/HUMAN_COMPARISON.md', 'utf8'), humanComparisonMarkdown(), 'docs/HUMAN_COMPARISON.md is current (run npm run docs)');
  for (const [name, e] of Object.entries(EXPORTS)) for (const [c] of e.columns) assert((await readFile('docs/DATA_DICTIONARY.md', 'utf8')).includes(`| ${c} |`), `${name}.${c} is documented`);
  for (const [k, a] of Object.entries(HUMAN_AREAS)) { assert(a.citations.length && a.humans && a.stebula && a.difference, `${k} is complete`); }
  assert((await readFile('docs/HUMAN_COMPARISON.md', 'utf8')).split('\n').filter(l => /^- .*\(verify\)$/.test(l)).length === Object.values(HUMAN_AREAS).reduce((n, a) => n + a.citations.length, 0), 'every citation is marked verify');
  await rm(d, { recursive: true });
  console.log('research record and exports ok');
}

// findings lifecycle
{
  const reg = freshRegistry();
  const proposal = { statement: 'It rarely asks questions.', prediction: { comparator: '<', value: 0.3, minN: 5 }, metric: { name: 'questions_per_turn', agent: 'A' }, humanArea: 'inner-speech', suggestedBy: ['r1'] };
  const f = createFinding(reg, proposal, '2026-01-01T00:00:00Z');
  assert.equal(f.status, 'proposed'); assert.equal(f.lockedAt, '2026-01-01T00:00:00Z'); assert(f.refutedIf.includes('not <'), 'a refutation condition is always stated');
  assert.throws(() => normalizeProposal({ ...proposal, prediction: { comparator: 'about', value: 'x' } }), /comparator/);
  assert.throws(() => normalizeProposal({ ...proposal, statement: '' }), /statement/);
  assert.throws(() => normalizeProposal({ statement: 's', metric: { name: 'vibes' }, prediction: { text: 'p' }, refutedIf: 'r' }), /design/);
  const custom = createFinding(reg, { statement: 'Order of reading changes traits.', metric: { name: 'custom' }, prediction: { text: 'Reversing the order changes the top trait.' }, refutedIf: 'Same top trait in both orders.', design: 'Run two agents with reversed reading order.', suggestedBy: ['r1'] });
  assert(custom.needsExperiment && !custom.computable); assert.throws(() => testFinding(reg, custom.id, {}), /needs an experiment/);
  const mkMem = matches => { const m = freshTalkMemory('A'); m.selfTests = matches.map(x => ({ match: x })); return m; };
  const mkReplies = (n, ask) => Array.from({ length: n }, (_, i) => [{ role: 'user', text: 'q', turn: i + 1 }, { role: 'assistant', text: ask ? 'Why?' : 'Fine.', turn: i + 1, monologue: { candidates: [] } }]).flat();
  const few = freshTalkMemory('A'); few.archive = mkReplies(3, false);
  const lowN = testFinding(reg, f.id, { A: few, B: freshTalkMemory('B') }, '2026-01-02T00:00:00Z');
  assert.equal(lowN.status, 'inconclusive', 'too few observations is inconclusive, not supported'); assert.equal(lowN.results[0].n, 3);
  const many = freshTalkMemory('A'); many.archive = mkReplies(6, false);
  assert.equal(testFinding(reg, f.id, { A: many, B: freshTalkMemory('B') }).status, 'supported');
  const askers = freshTalkMemory('A'); askers.archive = mkReplies(6, true);
  const refuted = testFinding(reg, f.id, { A: askers, B: freshTalkMemory('B') }, '2026-01-03T00:00:00Z');
  assert.equal(refuted.status, 'refuted'); assert.equal(refuted.results.length, 3);
  assert(refuted.results.every(r => r.n >= 3 && r.at && r.outcome && 'value' in r), 'results store the number, sample size, and date');
  assert.throws(() => testFinding(reg, f.id, { A: freshTalkMemory('A'), B: freshTalkMemory('B') }), /no data/);
  // no edits after data
  for (const k of ['prediction', 'statement', 'metric', 'refutedIf', 'results', 'status']) assert.throws(() => editFinding(reg, f.id, { [k]: 'x' }), /locked/, `${k} cannot be edited`);
  assert.deepEqual(verifyLocks(reg), []);
  const tamper = JSON.parse(JSON.stringify(reg)); tamper.findings[0].prediction.value = 0.9;
  assert.deepEqual(verifyLocks(tamper), [`${f.id}@1`], 'a hand edit to a locked prediction is detected');
  const v2 = reviseFinding(reg, f.id, { prediction: { value: 0.5 } }, '2026-02-01T00:00:00Z');
  assert.equal(v2.version, 2); assert.equal(v2.results.length, 0); assert.equal(v2.status, 'proposed'); assert.equal(v2.prediction.value, 0.5);
  assert.equal(current(reg, f.id).version, 2); assert.equal(reg.findings.find(x => x.id === f.id && x.version === 1).supersededBy, `${f.id}@2`);
  assert.equal(reg.findings.find(x => x.id === f.id && x.version === 1).prediction.value, 0.3, 'the old version keeps its original prediction');
  assert.deepEqual(verifyLocks(reg), []);
  assert.equal(editFinding(reg, f.id, { humanArea: 'theory-of-mind' }).humanArea, 'theory-of-mind', 'descriptive fields can change');
  const sp = createFinding(reg, { statement: 's', metric: { name: 'selfpredict_accuracy', agent: 'A' }, prediction: { comparator: '>', value: 0.5, minN: 2 } });
  assert.equal(testFinding(reg, sp.id, { A: mkMem(['yes', 'yes', 'no']), B: freshTalkMemory('B') }).status, 'supported');
  assert.deepEqual(aggregateStats({ A: mkMem(['yes', 'no']), B: freshTalkMemory('B') })['selfpredict_accuracy[A]'], { value: 0.5, n: 2 });
  // hypothesis generation: the model proposes, code validates and locks
  const mems = { A: askers, B: freshTalkMemory('B') };
  const records = [{ id: 'rX1', type: 'turn' }, { id: 'rX2', type: 'self_test' }];
  const gen = await generateHypotheses(reg, async ({ user }) => { assert(user.includes('rX1') && user.includes('questions_per_turn[A]'), 'the model sees stats and record ids'); return JSON.stringify({ hypotheses: [
    { statement: 'H1', suggestedBy: ['rX1', 'bogus'], prediction: { comparator: '>', value: 0.5 }, metric: { name: 'questions_per_turn', agent: 'A' } },
    { statement: 'H2 cites nothing real', suggestedBy: ['bogus'], prediction: { comparator: '>', value: 0.5 }, metric: { name: 'questions_per_turn', agent: 'A' } },
    { statement: 'H3 custom', suggestedBy: ['rX2'], prediction: { text: 'Something.' }, metric: { name: 'custom' }, refutedIf: 'Nothing changes.', design: 'Run two agents.' },
    { statement: 'H4', suggestedBy: ['rX1'], prediction: { comparator: '>', value: 1 }, metric: { name: 'hedging_rate', agent: 'A' } },
    { statement: 'H5 over the limit', suggestedBy: ['rX1'], prediction: { comparator: '>', value: 1 }, metric: { name: 'hedging_rate', agent: 'A' } },
  ] }); }, { mems, records });
  assert.equal(gen.created.length, 2, 'only the first 3 proposals are considered, and only valid ones are kept'); assert.equal(gen.rejected.length, 1);
  assert.deepEqual(gen.created[0].suggestedBy, ['rX1'], 'unknown record ids are dropped');
  assert(gen.created.every(h => h.status === 'proposed' && h.lockedAt && h.origin === 'model'));
  await assert.rejects(() => generateHypotheses(freshRegistry(), async () => '{}', { mems: { A: freshTalkMemory('A'), B: freshTalkMemory('B') }, records: [] }), /Not enough recorded data/);
  assert.equal(ensureDefaultFindings(reg).length, 3); assert.equal(ensureDefaultFindings(reg).length, 0, 'default experiment findings are created once');
  const fed = feedExperiment(reg, { runId: 'xT', conditions: {} });
  assert.deepEqual(fed, [], 'a run with no usable data feeds nothing');
  console.log('findings lifecycle ok');
}

// isolation experiment presets
{
  const d = await mkdtemp(join(tmpdir(), 'exp-'));
  const rec = makeRecorder(d), registryFile = join(d, 'findings.json');
  const calls = {};
  const run = await runIsolation(cond => { const base = rec.wrapLLM(research(th), `exp-${cond}`); return async c => { calls[cond] = (calls[cond] || 0) + 1; return base(c); }; },
    { dataDir: d, steps: 2, every: 1, record: (t, p) => rec.log(t, null, p), registryFile });
  assert.deepEqual(Object.keys(run.conditions), Object.keys(ISO_CONDITIONS));
  for (const [c, r] of Object.entries(run.conditions)) {
    assert.deepEqual(r.checkpoints.map(x => x.step), [0, 1, 2], `${c} is checked at the same fixed steps`);
    assert(r.checkpoints.every(x => x.answers.length === 5 && x.selfpredict.n === 2), `${c} gets the same 5 questions and 2 self-prediction tests at every checkpoint`);
  }
  const load = async c => makeTalkStore(join(d, 'experiments', run.runId, c)).load('A');
  const iso = await load('isolated'), soc = await load('social'), mix = await load('mixed'), base = await load('baseline');
  assert.equal(iso.episodes.length, 2); assert.equal(iso.turns, 0, 'isolated: reading only');
  assert.equal(soc.turns, 2); assert.equal(soc.episodes.length, 0, 'social: conversation only');
  assert.equal(mix.episodes.length, 1); assert.equal(mix.turns, 1, 'mixed: both');
  assert.equal(base.episodes.length, 0); assert.equal(base.turns, 0, 'baseline: nothing');
  assert(calls.baseline < calls.social, 'the baseline agent gets no stimulus calls');
  assert.equal(JSON.parse(await readFile(join(d, 'experiments', run.runId, 'result.json'), 'utf8')).runId, run.runId);
  const reg = JSON.parse(await readFile(registryFile, 'utf8'));
  assert.equal(reg.findings.filter(f => f.origin === 'code').length, 3, 'experiment findings were pre-registered');
  assert(run.fedFindings.length === 3 && reg.findings.every(f => f.results.length === 1 && f.results[0].runId === run.runId), 'results feed the registry automatically');
  assert(reg.findings.every(f => f.status === 'inconclusive'), 'one run is an anecdote: below minN it stays inconclusive');
  assert.deepEqual(verifyLocks(reg), []);
  for (const f of reg.findings) { const m = METRICS[f.metric.name]; assert.equal(m.source, 'experiment'); assert(f.lockedAt <= f.results[0].at, 'the prediction was locked before the data'); }
  const recs2 = await (async () => { await rec.flush(); return readRecords(d); })();
  assert(recs2.some(r => r.type === 'experiment' && r.payload.event === 'start') && recs2.some(r => r.type === 'experiment' && r.payload.event === 'finish'));
  assert(recs2.some(r => r.type === 'digest' && r.payload.experiment?.condition === 'isolated'), 'experiment activity is in the record, tagged with its condition');
  await assert.rejects(() => runIsolation(() => research(th), { dataDir: d, conditions: ['nope'] }), /at least one condition/);
  await rm(d, { recursive: true });
  console.log('experiment presets ok');
}
console.log('selftest passed');
