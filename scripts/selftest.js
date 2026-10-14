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
let r = await talkTurn(store, stub, 'A', 'What are you?');
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
console.log('selftest passed');
