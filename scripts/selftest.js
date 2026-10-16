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
console.log('selftest passed');
