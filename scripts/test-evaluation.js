// Audit regression tests, part 3: evaluation and experiment design, and the flagship lesson experiment.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { makeTalkStore, makeSnapshotStore, freshTalkMemory, talkSelfTest } from '../src/talk/session.js';
import { runExperiment as runIso, estimateCalls, plan, CHECKPOINT_STATEMENTS } from '../src/research/experiments.js';
import { makeRegistry, createFinding, feedExperiment, testFinding, evaluate, STATUS_TEXT, verifyLocks, freshRegistry } from '../src/research/findings.js';
import { METRICS } from '../src/research/metrics.js';
import { validateCandidates, buildItems, freshPersonality, ingestUpdates, norm } from '../src/talk/personality.js';
import { runExperiment as runEngine, CONDITIONS as ENGINE_CONDITIONS } from '../src/engine/run.js';
import { estimateBatchCalls, callsPerRun } from '../src/engine/estimate.js';
import { runValues, summarizeRuns } from '../src/engine/analyze.js';
import { makeAgentFactory } from '../src/agents/index.js';
import { makeMockAgent } from '../src/agents/mock.js';
import { PERSONAS, decisionPrompt } from '../src/agents/prompts.js';
import { createTask, RULES } from '../src/env/ruleTask.js';
import { makeRecorder, readRecords } from '../src/lib/records.js';
import { CancelledError } from '../src/lib/stage.js';
import { runLessonExperiment, runTrial, makeTasks, lessonFor, RELEVANT_LESSON, IRRELEVANT_LESSON, shuffledLesson, pairedSummary, summarizeLesson, estimateLessonCalls, BudgetError } from '../src/research/lesson.js';
import { makeLessonDouble } from '../src/research/lesson-double.js';

const tmp = async fn => { const d = await mkdtemp(join(tmpdir(), 'ev-')); try { return await fn(d); } finally { await rm(d, { recursive: true, force: true }); } };
const THOUGHTS = ['perception', 'memory', 'self-monitor', 'evaluation', 'initiative'].map((module, i) => ({ module, text: `t ${module}`, relevance: 0.9 - i * 0.1 }));
const sha = o => createHash('sha256').update(JSON.stringify(o)).digest('hex');

// A stub that answers every Talk stage validly. `fail` can break chosen stages.
const talkStub = (fail = {}) => async ({ system, messages, user, meta, stage }) => {
  if (meta) Object.assign(meta, { model: 'stub', stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } });
  if (fail[stage]) return fail[stage](meta);
  if (stage === 'think' || stage === 'digest-think') return JSON.stringify({ thoughts: THOUGHTS });
  if (stage === 'speak') return JSON.stringify({ reply: 'A reply.', self_model: { beliefs: ['b'], uncertainties: [], openQuestions: [] }, person_model: null, change_note: 'changed', claims: [], candidate_updates: [] });
  if (stage === 'digest-read') return JSON.stringify({ noticed: 'Noticed it.', connects: [], question: 'Why?', updates: [] });
  if (stage === 'personality-questions') return JSON.stringify({ answers: ['one', 'two', 'three', 'four', 'five'], updates: [] });
  if (stage === 'selftest-predict') return JSON.stringify({ predicted: 'agree', confidence: 0.5, reason: 'r' });
  if (stage === 'selftest-answer') return JSON.stringify({ stance: 'agree', reason: 'r' });
  return 'Folded.';
};

// ---- Unicode quotes, empty quotes, quote presence is not support ----
{
  const heb = 'הוא תמיד שואל שאלות על הנהר והאבן';
  const v = validateCandidates([
    { kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: 'שואל שאלות על הנהר' },   // present
    { kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: 'מדבר על הים הגדול' },     // absent Hebrew quote
    { kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: '...!?' },                  // punctuation only
    { kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: '   ' },                    // blank
    { kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: 'שואל' },                   // too short to be evidence
    { kind: 'trait', name: '???', direction: 'supports', evidence_quote: 'שואל שאלות על הנהר' },        // name with no letters
  ], heb);
  assert.equal(v.accepted.length, 1, 'only the present Hebrew quote passes');
  assert.deepEqual(v.rejected.map(r => r.why), ['quote not found in source text', 'quote has no letters or digits', 'no quote', 'quote too short to count as evidence', 'no name']);
  assert.notEqual(norm('שואל שאלות'), '', 'Hebrew survives normalization');
  assert.equal(validateCandidates([{ kind: 'trait', name: 'x', direction: 'supports', evidence_quote: 'ünïcode wörds hère' }], 'Some ÜNÏCODE wörds hère today').accepted.length, 1, 'accents are compared as themselves');
  assert.equal(validateCandidates([{ kind: 'trait', name: 'x', direction: 'supports', evidence_quote: 'the stone' }], 'the stoned river').accepted.length, 0, 'a quote must match whole words, not part of one');
  const mem = freshTalkMemory('A');
  ingestUpdates(mem, { source: 'S', sourceType: 'digest', ref: 'm1' }, [{ kind: 'trait', name: 'סקרן', direction: 'supports', evidence_quote: 'שואל שאלות על הנהר' }, { kind: 'trait', name: 'ישיר', direction: 'supports', evidence_quote: 'תמיד שואל שאלות' }], heb);
  assert.equal(buildItems(mem.personality).length, 2, 'different non-Latin names do not collapse into one item');
  const e = mem.personality.log[0];
  assert(e.quotePresent === true && e.supportReview === 'unreviewed', 'quote presence is recorded, and support for the trait is explicitly NOT reviewed');
  assert.equal(buildItems(mem.personality)[0].evidence[0].supportReview, 'unreviewed');
}

// ---- "established" is reconsidered when counterevidence accumulates ----
{
  const mk = dirs => { const p = freshPersonality(); dirs.forEach(([d, src], i) => { const ev = { id: `e${i + 1}` }; p.log.push({ n: i + 1, eventId: ev.id, id: 'trait:bold', kind: 'trait', name: 'bold', direction: d, quote: 'q', source: src, at: 't' }); }); return buildItems(p)[0]; };
  assert.equal(mk([['supports', 'A'], ['supports', 'B'], ['supports', 'A']]).status, 'established');
  assert.equal(mk([['supports', 'A'], ['supports', 'B'], ['supports', 'A'], ['contradicts', 'B']]).status, 'forming', 'three supports and a contradiction leave strength 0.25, below the 0.3 needed to stay established');
  assert.equal(mk([['supports', 'A'], ['supports', 'B'], ['supports', 'A'], ['supports', 'B'], ['contradicts', 'A']]).status, 'established', 'one dissent in five does not undo it');
  assert.equal(mk([['supports', 'A'], ['supports', 'B'], ['supports', 'A'], ['contradicts', 'B'], ['contradicts', 'A']]).status, 'contested', 'substantial counterevidence makes it contested');
  assert.equal(mk([['supports', 'A'], ['supports', 'B'], ['supports', 'A'], ['supports', 'B'], ['contradicts', 'A'], ['contradicts', 'A'], ['contradicts', 'B']]).status, 'contested');
}

// ---- idempotent result ingestion, pilot labels, exploratory vs confirmatory ----
{
  const reg = freshRegistry();
  const f = createFinding(reg, { statement: 's', metric: { name: 'exp_traits_isolated_minus_social' }, prediction: { comparator: '>', value: 0, minN: 2 }, origin: 'code' }, '2026-01-01T00:00:00Z');
  const run = (id, iso, soc) => ({ runId: id, at: '2026-02-01T00:00:00Z', conditions: { isolated: { complete: true, checkpoints: [{ traits: Array(iso).fill({ name: 'a' }) }] }, social: { complete: true, checkpoints: [{ traits: Array(soc).fill({ name: 'a' }) }] } } });
  assert.deepEqual(feedExperiment(reg, run('xA', 3, 1), '2026-02-01T00:00:00Z'), [`${f.id}@1`]);
  assert.deepEqual(feedExperiment(reg, run('xA', 3, 1)), [], 'the same run id is ignored the second time');
  assert.equal(f.results.length, 1, 'a duplicate run id cannot inflate the count');
  assert.equal(evaluate(f).status, 'inconclusive', 'one run is below minN');
  feedExperiment(reg, run('xB', 2, 1));
  assert.equal(evaluate(f).status, 'pilot-consistent'); assert(/no significance test/i.test(STATUS_TEXT['pilot-consistent']), 'the label says it is a pilot, not a verdict');
  assert(!['supported', 'refuted'].includes(f.status), 'no strong verdict words are used');
  const old = { ...run('xOld', 9, 0), at: '2025-12-01T00:00:00Z' };
  assert.deepEqual(feedExperiment(reg, old), [], 'data collected before the prediction was locked cannot test it');
  const incomplete = run('xC', 0, 5); incomplete.conditions.isolated.complete = false;
  assert.deepEqual(feedExperiment(reg, incomplete), [], 'a run with a failed condition contributes nothing');
  // a stats finding is tested only on data recorded after the lock
  const reg2 = freshRegistry();
  const sf = createFinding(reg2, { statement: 'q', metric: { name: 'questions_per_turn', agent: 'A' }, prediction: { comparator: '>', value: 0.5, minN: 2 }, origin: 'model', suggestedBy: ['r1'] }, '2026-06-01T00:00:00Z');
  const m = freshTalkMemory('A');
  m.archive = Array.from({ length: 6 }, (_, i) => ({ role: 'assistant', text: 'Why?', at: '2026-05-01T00:00:00Z', turn: i, monologue: { candidates: [] } }));
  assert.throws(() => testFinding(reg2, sf.id, { A: m, B: freshTalkMemory('B') }), /since this finding was locked/, 'a hypothesis suggested by existing statistics is not tested on those statistics');
  m.archive.push(...Array.from({ length: 3 }, (_, i) => ({ role: 'assistant', text: 'Why?', at: '2026-07-01T00:00:00Z', turn: 9 + i, monologue: { candidates: [] } })));
  const r = testFinding(reg2, sf.id, { A: m, B: freshTalkMemory('B') });
  assert.equal(r.results[0].n, 3, 'only the 3 replies recorded after the lock were measured'); assert.equal(r.results[0].scope, 'since-lock');
  // a metric that cannot be restricted to new data is exploratory and never earns a consistent/inconsistent label
  const ex = createFinding(reg2, { statement: 'ab', metric: { name: 'ab_trait_divergence' }, prediction: { comparator: '>', value: 0, minN: 1 } }, '2026-06-01T00:00:00Z');
  const ma = freshTalkMemory('A'), mb = freshTalkMemory('B');
  for (const [mm, nm] of [[ma, 'curious'], [mb, 'bold']]) ingestUpdates(mm, { source: 'S', sourceType: 'digest', ref: null }, [{ kind: 'trait', name: nm, direction: 'supports', evidence_quote: 'a long enough quote' }], 'a long enough quote here');
  const er = testFinding(reg2, ex.id, { A: ma, B: mb });
  assert.equal(er.status, 'exploratory'); assert.equal(er.results[0].evidenceClass, 'exploratory');
  assert.deepEqual(verifyLocks(reg2), []);
}

// ---- model-call estimates come from the plan ----
{
  assert.equal(estimateBatchCalls({ seeds: 20, rounds: 4 }), 2040, 'four conditions, twenty seeds, four rounds: 2,040 calls before retries');
  assert.equal(estimateBatchCalls({ seeds: 1, rounds: 4 }), 102);
  // and the estimate equals what a run really calls (no retries needed with a tolerant stub)
  let n = 0;
  const counting = async () => { n++; return '{}'; };
  for (const id of Object.keys(ENGINE_CONDITIONS)) {
    n = 0;
    await runEngine({ condition: id, seed: 1, rounds: 4, episodes: 2, mode: 'live' }, { makeAgent: makeAgentFactory({ mode: 'live', llm: counting, seed: 1 }) });
    assert.equal(n, callsPerRun(id, { rounds: 4, episodes: 2 }), `${id}: estimate equals actual calls`);
  }
  // the isolation experiment's estimate matches its plan too
  assert.equal(estimateCalls({ conditions: ['isolated', 'social', 'mixed', 'baseline'], steps: 6, every: 3 }), plan({ steps: 6, every: 3 }).reduce((t, p) => t + p.steps.length * 2 + p.checkpoints.length * 7, 0));
}

// ---- dyad members are not independent replications ----
{
  const mkRun = (cond, seed) => runEngine({ condition: cond, seed, rounds: 2, episodes: 2, mode: 'mock' }, { makeAgent: makeAgentFactory({ mode: 'mock', seed }) });
  const runs = [];
  for (const seed of [1, 2, 3]) for (const condition of ['dyad-reflect', 'single-reflect']) runs.push({ condition, seed, values: runValues(await mkRun(condition, seed)) });
  const s = summarizeRuns(runs);
  assert.equal(s['dyad-reflect'].runs, 3, 'three dyad runs count as 3, not 6 agents');
  assert.equal(s['single-reflect'].runs, 3);
  assert.equal(runs.find(r => r.condition === 'dyad-reflect').values.agents, 2, 'the two agents are averaged inside their run');
  const failed = runValues([{ type: 'run_error', message: 'x' }]);
  assert.equal(failed, null, 'a failed run is not a trial');
  assert.equal(summarizeRuns([{ condition: 'c', seed: 1, values: null }, { condition: 'c', seed: 2, values: runs[0].values }]).c.invalidRuns, 1);
}

// ---- first hypotheses come from the same observation snapshot ----
{
  const seen = [];
  const spy = id => { const a = makeMockAgent({ id, persona: PERSONAS[id], seed: 5 }); const probe = a.probe.bind(a); return { ...a, probe: async ctx => { seen.push({ id, round: ctx.round, obs: ctx.observations.length, partner: Boolean(ctx.partner) }); return probe(ctx); } }; };
  const events = await runEngine({ condition: 'dyad-reflect', seed: 5, rounds: 2, episodes: 1, mode: 'mock' }, { makeAgent: spy });
  const r0 = seen.filter(s => s.round === 0);
  assert.deepEqual(r0.map(s => s.obs), [0, 0], 'agent B does not see agent A\'s first probe result before choosing its own');
  assert(r0.every(s => !s.partner), 'and neither sees the other\'s first message');
  const initial = events.find(e => e.type === 'initial_hypotheses');
  assert(initial && initial.snapshotObservations === 0 && Object.keys(initial.hypotheses).length === 2, 'both initial hypotheses are recorded from the same snapshot');
  assert(events.find(e => e.type === 'episode_start').memoryHash.A, 'the memory an episode started from is recorded');
}

// ---- live/mock information flow is the same ----
{
  const task = createTask(0, 11);
  const decisionCtx = { seeds: task.seeds, observations: [], notes: [], memory: { selfModel: { strategy: '' }, lessons: [], history: [] }, testTriples: task.test.map(x => x.triple) };
  const synthesis = { final_hypothesis: 'The triple is accepted when each number is larger than the one before.', confidence: 0.7, mockRule: 'increasing' };
  const viaSynth = (await makeMockAgent({ id: 'A', persona: PERSONAS.A, seed: 1 }).decide({ ...decisionCtx, synthesis })).obj.labels;
  assert.deepEqual(viaSynth, decisionCtx.testTriples.map(t => (RULES.increasing.fn(t) ? 'accept' : 'reject')), 'the scripted agent applies the synthesis it is handed');
  // a fresh agent with no hidden internal state gives the same answer to the same input
  assert.deepEqual((await makeMockAgent({ id: 'A', persona: PERSONAS.A, seed: 99 }).decide({ ...decisionCtx, synthesis })).obj.labels, viaSynth, 'no private state: same input, same decision');
  assert(decisionPrompt({ ...decisionCtx, synthesis }).includes(synthesis.final_hypothesis), 'a live model is shown the same synthesis in the decision prompt');
  assert(!decisionPrompt(decisionCtx).includes('final hypothesis'), 'and when there is none, nothing is invented');
  // inside the engine the decision call receives the agent's synthesis
  let got = null;
  const factory = id => { const a = makeMockAgent({ id, persona: PERSONAS[id], seed: 3 }); return { ...a, decide: async ctx => { got = ctx; return a.decide(ctx); } }; };
  await runEngine({ condition: 'single-reflect', seed: 3, rounds: 1, episodes: 1, mode: 'mock' }, { makeAgent: factory });
  assert(got.synthesis && 'final_hypothesis' in got.synthesis, 'the engine passes the synthesis to the decision call');
}

// ---- checkpoints assess immutable snapshots ----
await tmp(async d => {
  const store = makeTalkStore(d);
  const mem = freshTalkMemory('A'); mem.episodes = [{ id: 'm1', kind: 'passage', source: 'S', passage: 1, summary: 'A stored memory.', eventId: null }];
  await store.save(mem);
  const before = sha(await store.load('A'));
  const snap = makeSnapshotStore(await store.load('A'));
  await talkSelfTest(snap, talkStub(), 'A', 'A statement to assess.', () => {}, { assessment: true });
  assert.equal((await snap.load('A')).selfTests.length, 1, 'the assessment result lives in the snapshot');
  assert.equal(sha(await store.load('A')), before, 'the real memory is byte-for-byte unchanged');
});
await tmp(async d => {
  const registry = makeRegistry(join(d, 'findings.json'));
  // protocol written before the first model call: check by listing the run folder from inside the first call
  const { readdirSync, existsSync } = await import('node:fs');
  let seenAtFirstCall = null;
  const run = await runIso(() => async c => { if (seenAtFirstCall === null) { const dir = join(d, 'experiments'); const ids = readdirSync(dir); seenAtFirstCall = ids.length === 1 && existsSync(join(dir, ids[0], 'protocol.json')); } return talkStub()(c); },
    { dataDir: d, steps: 2, every: 1, registry, mode: 'test', model: 'stub', revision: { commit: 'abc' } });
  assert.equal(seenAtFirstCall, true, 'the protocol was on disk before the first model call');
  const proto = JSON.parse(await readFile(join(d, 'experiments', run.runId, 'protocol.json'), 'utf8'));
  assert(proto.hash && proto.lockedAt && proto.predictions.length === 3 && proto.predictions.every(p => !/lesson/.test(p.finding + p.statement)) && proto.predictions.every(p => p.lockHash && p.prediction), 'it carries the predictions with their lock hashes');
  assert(proto.lockedAt <= run.at, 'locked before the run started collecting');
  assert(run.manifest.promptVersion && run.manifest.revision.commit === 'abc' && run.manifest.model === 'stub' && run.manifest.estimatedCalls > 0, 'the manifest names model, prompt version and code revision');
  assert(run.usage.calls > 0 && run.usage.input_tokens > 0, 'usage is recorded');
  // treatment memory is untouched by checkpoints: the social agent has exactly its conversation, no self-tests
  const soc = await makeTalkStore(join(d, 'experiments', run.runId, 'social')).load('A');
  assert.equal(soc.selfTests.length, 0, 'checkpoint self-tests did not write into the treatment memory');
  const base = await makeTalkStore(join(d, 'experiments', run.runId, 'baseline')).load('A');
  assert.equal(base.selfTests.length, 0, 'nor into the baseline');
  assert(Object.values(run.conditions).every(c => c.checkpoints.every(cp => cp.assessment === true && cp.memoryHash)), 'each checkpoint is marked as an assessment of a hashed snapshot');
});
// failures are excluded, never counted; cancellation stops calls and feeds nothing
await tmp(async d => {
  const registry = makeRegistry(join(d, 'findings.json'));
  const failSocial = cond => async c => (cond === 'social' && c.stage === 'speak' ? 'garbage' : talkStub()(c));
  const run = await runIso(failSocial, { dataDir: d, steps: 2, every: 1, registry, model: 'stub' });
  assert.equal(run.conditions.social.complete, false); assert(run.conditions.social.failures.length >= 1);
  assert(run.exclusions.some(e => e.condition === 'social' && /failed/.test(e.reason)), 'exclusions are listed with a reason');
  assert.equal(METRICS.exp_traits_isolated_minus_social.compute(run), null, 'a metric needing the failed condition returns nothing');
  const reg = await registry.read(), needsSocial = reg.findings.find(f => f.metric.name === 'exp_traits_isolated_minus_social');
  assert(!run.fedFindings.includes(`${needsSocial.id}@1`) && needsSocial.results.length === 0, 'nothing is fed to the registry from the incomplete condition');
  assert(run.fedFindings.length === 1, 'findings that only use complete conditions are still fed');
});
await tmp(async d => {
  const registry = makeRegistry(join(d, 'findings.json')); const ac = new AbortController(); let calls = 0;
  const logged = [];
  const run = await runIso(() => async c => { calls++; if (calls === 12) ac.abort(); return talkStub()(c); }, { dataDir: d, steps: 3, every: 1, registry, signal: ac.signal, record: (t, p) => logged.push([t, p.event]) });
  assert.equal(run.status, 'cancelled'); const after = calls;
  await new Promise(r => setTimeout(r, 30)); assert.equal(calls, after, 'no model calls after cancellation');
  assert(calls < estimateCalls({ steps: 3, every: 1 }), 'it stopped early');
  assert(logged.some(([t, e]) => t === 'experiment' && e === 'cancelled'), 'the final state is recorded');
  assert.equal(JSON.parse(await readFile(join(d, 'experiments', run.runId, 'result.json'), 'utf8')).status, 'cancelled', 'the partial result is saved, marked cancelled');
  assert.deepEqual((await registry.read()).findings.filter(f => f.results.length), [], 'a cancelled run feeds nothing');
});

// ---- the flagship lesson experiment ----
{
  assert(Math.abs(RELEVANT_LESSON.length - IRRELEVANT_LESSON.length) / RELEVANT_LESSON.length < 0.2, 'the irrelevant lesson has about the same length');
  assert.deepEqual(shuffledLesson(3).split(' ').sort(), RELEVANT_LESSON.split(' ').sort(), 'the shuffled lesson has the same words');
  assert.notEqual(shuffledLesson(3), RELEVANT_LESSON);
  assert.equal(lessonFor('none'), null);
  // matched tasks: the same tasks for every condition
  assert.deepEqual(makeTasks(5, 2).map(t => t.seed), makeTasks(5, 2).map(t => t.seed));
  assert.equal(estimateLessonCalls({ tasks: 8, conditions: ['relevant', 'none', 'irrelevant'] }), 48);
  await tmp(async d => {
    const log = [], recs = [];
    const double = makeLessonDouble({ seed: 1, log });
    const run = await runLessonExperiment(double, { dataDir: d, tasks: 8, seed: 1, mode: 'scripted-double', record: (t, p) => recs.push([t, p]), model: 'scripted-double', revision: { commit: 'abc' } });
    assert.equal(run.status, 'complete'); assert.equal(run.trials.length, 24);
    const perTask = [0, 1, 2, 3, 4, 5, 6, 7].map(i => run.trials.filter(t => t.taskIndex === i));
    assert(perTask.every(ts => ts.length === 3 && new Set(ts.map(t => t.seed)).size === 1), 'every condition gets the same tasks');
    // information boundary: no prompt ever contains the hidden rule, the decoy, or the answers
    const tasks = makeTasks(8, 1);
    for (const t of run.trials) for (const p of t.prompts) {
      const task = tasks[t.taskIndex].task;
      for (const secret of [task.targetText, task.decoyText, 'hidden rule is', 'decoy']) assert(!`${p.system}\n${p.user}`.includes(secret), `ground truth leaked into a prompt: ${secret}`);
    }
    // the lesson is only counted as delivered if it was in the request
    for (const t of run.trials) assert.equal(t.lessonDelivered, Boolean(t.lesson), 'delivery is verified from the request itself');
    const sys = c => log.filter(l => l.stage === 'lesson-probe' && l.system.includes(c));
    assert(sys('predicts will be rejected').length === 8 && sys('Short messages').length === 8, 'relevant and irrelevant lessons reach exactly their own trials');
    assert.equal(log.filter(l => l.stage === 'lesson-probe' && !l.system.includes('Lessons you have written down')).length, 8, 'the no-lesson control receives no lesson');
    // prediction is recorded before the outcome, per trial
    const order = recs.map(([t]) => t);
    for (let i = 0; i < order.length; i++) if (order[i] === 'lesson_outcome') assert.equal(order[i - 1], 'lesson_prediction', 'the prediction record comes right before its outcome');
    assert.equal(order.filter(t => t === 'lesson_prediction').length, 24);
    // scoring is against ground truth computed by code, and the scripted lesson effect shows up in the plumbing
    const s = run.summary;
    assert(s.perCondition.relevant.discriminatingAccuracy > s.perCondition.none.discriminatingAccuracy, 'the scripted double responds to the delivered lesson');
    assert.equal(s.perCondition.none.discriminatingAccuracy, s.perCondition.irrelevant.discriminatingAccuracy, 'an irrelevant lesson changes nothing in the double');
    assert(/Pilot/.test(s.label)); assert.equal(s.versusNone.relevant.matchedTasks, 8);
    assert(run.manifest.mode === 'scripted-double' && run.manifest.lessonLengths.relevant > 0 && run.protocol.hash);
    for (const t of run.trials) assert(t.prompts.every(p => p.raw !== undefined) && t.context.mode === 'on', 'every trial keeps its prompts, raw outputs and context for replay');
    const onDisk = JSON.parse(await readFile(join(d, 'experiments', run.runId, 'result.json'), 'utf8'));
    assert.equal(onDisk.trials.length, 24);
  });
  // invalid trials are counted, shown, and excluded from every average
  await tmp(async d => {
    const double = makeLessonDouble({ seed: 1 });
    const bad = async c => (c.stage.startsWith('lesson-decide') && c.system.includes('Short messages') ? 'not json' : double(c));   // every irrelevant-lesson decision is unreadable
    const run = await runLessonExperiment(bad, { dataDir: d, tasks: 6, seed: 1 });
    const inv = run.trials.filter(t => !t.valid);
    assert.equal(inv.length, 6); assert(inv.every(t => t.condition === 'irrelevant' && t.invalid.stage === 'decide' && t.invalid.kind === 'malformed'));
    const pc = run.summary.perCondition;
    assert.deepEqual([pc.irrelevant.trials, pc.irrelevant.valid, pc.irrelevant.invalid], [6, 0, 6], 'invalid counts are reported per condition');
    assert.equal(pc.irrelevant.accuracy, null, 'an all-invalid condition has no accuracy, not a zero');
    assert.deepEqual(pc.irrelevant.invalidKinds, { 'decide:malformed': 6 });
    assert(pc.relevant.valid === 6 && pc.none.valid === 6);
    assert.equal(run.exclusions.length, 6); assert.equal(run.conditions.irrelevant.complete, false);
    assert.equal(run.summary.versusNone.irrelevant.matchedTasks, 0, 'invalid trials never enter a comparison');
    assert.equal(run.summary.versusNone.relevant.matchedTasks, 6);
    assert(run.trials.find(t => !t.valid).prompts.length === 2 && run.trials.find(t => !t.valid).prompts[1].raw, 'the failed attempt keeps its raw output for inspection');
  });
  // budget and cancellation
  await tmp(async d => {
    await assert.rejects(() => runLessonExperiment(makeLessonDouble(), { dataDir: d, tasks: 8, maxCalls: 10 }), BudgetError);
    // The estimate fits the budget, but one retry pushes the real count over it: the run stops, says so, and keeps what it has.
    let n = 0; const dbl = makeLessonDouble();
    const run = await runLessonExperiment(async c => { n++; return n === 1 ? 'unreadable' : dbl(c); }, { dataDir: d, tasks: 4, maxCalls: 24 });
    assert.equal(run.status, 'stopped-budget'); assert(n <= 24, 'a run never exceeds its call budget'); assert(run.trials.length >= 1 && run.trials.length < 12, 'completed trials are kept');
    const ac = new AbortController(); let k = 0;
    const r2 = await runLessonExperiment(async c => { if (++k === 5) ac.abort(); return dbl(c); }, { dataDir: d, tasks: 6, signal: ac.signal });
    assert.equal(r2.status, 'cancelled'); const k2 = k; await new Promise(r => setTimeout(r, 20)); assert.equal(k, k2, 'no further calls after cancellation');
  });
  // paired summary numbers
  const ps = pairedSummary([0.2, 0.4, 0.0, 0.2]);
  assert.equal(ps.n, 4); assert.equal(ps.mean, 0.2); assert.equal(ps.positive, 3); assert.equal(ps.ties, 1);
  assert(ps.ci95[0] < 0.2 && ps.ci95[1] > 0.2 && Math.abs((ps.ci95[1] - ps.ci95[0]) / 2 - 3.182 * Math.sqrt(0.08 / 3) / 2) < 0.002, 'a t-based 95% interval');
  assert.equal(pairedSummary([0.5]).ci95, null, 'one pair gives no interval'); assert.equal(pairedSummary([]).mean, null);
}

console.log('evaluation and lesson experiment ok');
