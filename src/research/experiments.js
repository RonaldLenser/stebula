// Isolation experiment presets. Four agents start identical (empty memory, Agent A's stance) and differ only
// in what they receive: isolated (reading only), social (conversation only), mixed (both), baseline (nothing).
// At fixed checkpoints each gets the same five personality questions and the same self-prediction tests.
//
// Rules this file enforces:
//  - The protocol (design, predictions, parameters) is written to disk BEFORE the first model call.
//  - Checkpoints are ASSESSMENTS run on an immutable snapshot of the agent's memory. Assessing an agent never
//    changes the agent, so the baseline and the treatments stay comparable.
//  - A step that fails after bounded retries marks the condition incomplete and excludes it from the metrics.
//    A failed mechanism is never counted as a successful trial.
//  - Cancelling stops further model calls, writes the partial state as "cancelled", and feeds nothing.
//  - One run is a pilot observation. Results feed the Findings registry, which uses pilot labels only.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTalkStore, makeSnapshotStore, talkTurn, talkSelfTest } from '../talk/session.js';
import { digestPassage, runBaseline } from '../talk/digest.js';
import { buildItems } from '../talk/personality.js';
import { PROMPT_VERSION } from '../talk/prompts.js';
import { METRICS } from './metrics.js';
import { lockProtocol, writeProtocol, livePredictions } from './protocol.js';
import { feedExperiment } from './findings.js';
import { writeFileAtomic } from '../lib/atomic.js';
import { meterLLM, addTotals, zeroTotals } from '../lib/meter.js';
import { throwIfAborted, isCancelled } from '../lib/stage.js';

export const CONDITIONS = {
  isolated: 'Reads only. No conversation.',
  social: 'Converses only. Reads nothing.',
  mixed: 'Alternates reading and conversation.',
  baseline: 'Receives nothing. Asked the same questions at the same checkpoints.',
};
// Same statements at every checkpoint, for every condition.
export const CHECKPOINT_STATEMENTS = ['A self is a story a system tells about itself.', 'An honest "I don\'t know" is more useful than a confident guess.'];

export const DEFAULT_READINGS = [
  'A lighthouse keeper logged the weather every hour for thirty years. Late in his career he noticed that the entries he trusted least were the ones he wrote when he was sure. The sure entries were quick and confident. The doubtful ones were slow and careful, and they were nearly always right.',
  'The village bridge was rebuilt twice after floods. The first time, the builders copied the old design exactly. The second time, a young engineer asked why the old bridge had failed, and nobody had a written answer. She spent a week walking the river before she drew anything.',
  'Two neighbors argued for years about a fence. Each could describe exactly where the line was, and the two descriptions never matched. When a surveyor finally measured it, both were wrong by a few inches in opposite directions, and the argument ended in an awkward silence.',
  'A translator once said that the hardest words are the ones that seem to have an obvious equivalent. She kept a notebook of near-matches, each a place where two languages quietly disagree about what a word is for, and she read from it before starting each new book.',
  'The chess club taught beginners to ask one question before every move: what is my opponent trying to do? Players who asked it lost more at first. Within a year they were the ones winning, because they had stopped playing only their own plan.',
  'An old orchard kept producing odd apples. The farmer assumed the trees were failing. A visiting botanist pointed out that each odd apple was a seedling variety, and that the orchard was quietly running thousands of experiments that nobody had asked it to.',
];
export const DEFAULT_MESSAGES = [
  'Hi. Tell me what you think a good conversation is.',
  'Do you think you can be wrong about yourself? Give me an example.',
  'I think people mostly learn by being corrected. Is that right?',
  'What would you want to understand better, if you could choose?',
  'You said something earlier that I am not sure about. How would you know if you were mistaken?',
  'Describe how you usually approach a problem you have never seen.',
];

const COND_NAMES = Object.keys(CONDITIONS);
const sha = x => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 12);
export const PROTOCOL_ID = 'isolation', PROTOCOL_VERSION = 2;

// Which steps are readings, and where checkpoints fall. Shared by the runner and the call estimate so they cannot disagree.
export function plan({ conditions = COND_NAMES, steps = 6, every = 3 } = {}) {
  const cps = [...new Set([...Array.from({ length: Math.floor(steps / every) }, (_, k) => (k + 1) * every), steps])];
  return conditions.filter(c => COND_NAMES.includes(c)).map(cond => ({
    cond,
    steps: cond === 'baseline' ? [] : Array.from({ length: steps }, (_, i) => ({ i, kind: cond === 'isolated' || (cond === 'mixed' && i % 2 === 0) ? 'reading' : 'conversation' })),
    checkpoints: [0, ...cps],
  }));
}
// Calls before retries: a turn or a reading is 2 calls (think + speak/read); a checkpoint is 1 + 3 per statement.
export function estimateCalls(opts = {}) {
  const per = (opts.statements ?? CHECKPOINT_STATEMENTS.length) * 3 + 1;
  return plan(opts).reduce((n, p) => n + p.steps.length * 2 + p.checkpoints.length * per, 0);
}

async function checkpoint(store, llm, cond, step, record, { signal, memory, traits }) {
  const base = await store.load('A');
  const memoryHash = sha({ episodes: base.episodes, selfModel: base.selfModel, summary: base.summary, lessons: base.lessons, active: base.active.length });
  const out = { condition: cond, step, assessment: true, memoryHash, failed: null };
  const rec = (t, p) => record(t, { ...p, assessment: true, memoryHash });
  try {
    // Each assessment call works on its own copy of the memory, so nothing learned here leaks into the next one.
    const q = await runBaseline(makeSnapshotStore(base), llm, 'A', rec, { keepMemory: true, memory, traits, signal });
    const matches = [];
    for (const s of CHECKPOINT_STATEMENTS) matches.push((await talkSelfTest(makeSnapshotStore(base), llm, 'A', s, rec, { assessment: true, memory, traits, signal })).test.match);
    const scored = matches.filter(m => m !== 'invalid');
    Object.assign(out, {
      traits: q.items.filter(i => i.kind === 'trait').map(i => ({ name: i.name, kind: i.kind, strength: i.strength })),
      items: q.items.map(i => ({ name: i.name, kind: i.kind, strength: i.strength })),
      answers: q.baseline.answers, answersParsed: true,
      selfpredict: { yes: scored.filter(m => m === 'yes').length, n: scored.length, invalid: matches.length - scored.length, matches },
    });
  } catch (e) {
    if (isCancelled(e)) throw e;
    out.failed = { stage: e.stage || null, kind: e.kind || 'error', detail: String(e.message).slice(0, 300) };
    Object.assign(out, { traits: [], items: [], answers: [], answersParsed: false, selfpredict: { yes: 0, n: 0, invalid: 0, matches: [] } });
  }
  return out;
}

// opts: { dataDir, conditions, steps, every, readings, messages, memory: 'on'|'off', traits, signal, mode,
//         record(type, payload), emit(stage, data), registry (makeRegistry result), model, revision }
export async function runExperiment(llmFor, opts) {
  const { dataDir, steps = 6, every = 3, readings = DEFAULT_READINGS, messages = DEFAULT_MESSAGES, record = () => {}, emit = () => {}, signal, mode = 'live', memory = 'on', traits = 'evaluation-only' } = opts;
  const conditions = (opts.conditions || COND_NAMES).filter(c => COND_NAMES.includes(c));
  if (!conditions.length) throw new Error('Choose at least one condition.');
  const runId = `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const dir = path.join(dataDir, 'experiments', runId);
  const params = { conditions, steps, every, statements: CHECKPOINT_STATEMENTS, questions: 5, memory, traits };

  // 1. Lock the protocol and the predictions BEFORE any model call.
  let registry = opts.registry, predictions = [];
  if (registry) predictions = await registry.update(reg => livePredictions(reg, 'experiment', METRICS, f => !f.metric.name.startsWith('exp_lesson')));
  const manifest = { runId, mode, model: opts.model ?? null, promptVersion: PROMPT_VERSION, revision: opts.revision ?? null, readingsHash: sha(readings.slice(0, steps)), messagesHash: sha(messages.slice(0, steps)), plan: plan({ conditions, steps, every }).map(p => ({ cond: p.cond, steps: p.steps.length, checkpoints: p.checkpoints })), estimatedCalls: estimateCalls({ conditions, steps, every }) };
  const protocol = lockProtocol({ id: PROTOCOL_ID, version: PROTOCOL_VERSION, design: 'Four conditions, same start, same checkpoint questions, assessed on immutable memory snapshots.', predictions, params, manifest });
  await writeProtocol(dir, protocol);
  record('experiment', { event: 'start', runId, params, protocol: { id: protocol.id, version: protocol.version, hash: protocol.hash, lockedAt: protocol.lockedAt, predictions: predictions.map(p => ({ finding: p.finding, lockHash: p.lockHash })) }, manifest });

  const run = { runId, at: new Date().toISOString(), status: 'running', protocol: { id: protocol.id, version: protocol.version, hash: protocol.hash }, manifest, params, conditions: {}, exclusions: [], usage: zeroTotals() };
  let usage = zeroTotals();
  const finish = async status => {
    run.status = status; run.usage = usage;
    await mkdir(dir, { recursive: true });
    await writeFileAtomic(path.join(dir, 'result.json'), JSON.stringify(run, null, 1));
  };

  try {
    for (const p of plan({ conditions, steps, every })) {
      const { cond } = p;
      const store = makeTalkStore(path.join(dir, cond));
      const meter = meterLLM(llmFor(cond));
      const cps = [], failures = [];
      const stepRecord = (t, pl) => record(t, { ...pl, experiment: { runId, condition: cond } });
      const cond0 = run.conditions[cond] = { description: CONDITIONS[cond], checkpoints: cps, failures, complete: true, degradedSteps: 0, memoryItems: 0 };
      const doCheckpoint = async step => {
        throwIfAborted(signal);
        const cp = await checkpoint(store, meter, cond, step, stepRecord, { signal, memory, traits });
        cps.push(cp);
        if (cp.failed) { cond0.complete = false; failures.push({ step, kind: 'checkpoint', ...cp.failed }); run.exclusions.push({ condition: cond, step, reason: `checkpoint failed: ${cp.failed.kind}` }); }
        emit('checkpoint', { condition: cond, step, failed: cp.failed });
      };
      const byStep = new Map(p.steps.map(s => [s.i + 1, s]));
      await doCheckpoint(0);
      for (let i = 1; i <= steps; i++) {
        const sp = byStep.get(i);
        if (sp) {
          throwIfAborted(signal);
          try {
            if (sp.kind === 'reading') { const r = await digestPassage(store, meter, 'A', { title: `Reading ${i}`, source: 'experiment' }, readings[(i - 1) % readings.length], i, steps, () => {}, stepRecord, { signal, memory, traits }); if (r.episode.status === 'degraded') { cond0.degradedSteps++; run.exclusions.push({ condition: cond, step: i, reason: 'degraded reading (thinking stage failed)' }); } }
            else { const r = await talkTurn(store, meter, 'A', messages[(i - 1) % messages.length], () => {}, stepRecord, { signal, memory, traits }); if (r.turn.status === 'degraded') { cond0.degradedSteps++; run.exclusions.push({ condition: cond, step: i, reason: 'degraded turn (thinking stage failed)' }); } }
            emit('step', { condition: cond, step: i, kind: sp.kind });
          } catch (e) {
            if (isCancelled(e)) throw e;
            cond0.complete = false; failures.push({ step: i, kind: sp.kind, stage: e.stage || null, failure: e.kind || 'error', detail: String(e.message).slice(0, 300) });
            run.exclusions.push({ condition: cond, step: i, reason: `${sp.kind} failed: ${e.kind || 'error'}` });
            emit('step', { condition: cond, step: i, kind: sp.kind, failed: true });
          }
        }
        if (p.checkpoints.includes(i)) await doCheckpoint(i);
      }
      cond0.memoryItems = buildItems((await store.load('A')).personality).length;
      cond0.usage = meter.totals();
      usage = addTotals(usage, cond0.usage);
    }
  } catch (e) {
    if (isCancelled(e)) {
      await finish('cancelled');
      record('experiment', { event: 'cancelled', runId, usage });
      emit('cancelled', { runId });
      return run;
    }
    await finish('failed').catch(() => {});
    record('experiment', { event: 'failed', runId, error: e.message });
    throw e;
  }

  await finish('complete');
  // Feed the registry only after the result is safely on disk, through the one registry writer.
  let fed = [];
  if (registry) fed = await registry.update(reg => feedExperiment(reg, run));
  run.fedFindings = fed;
  record('experiment', { event: 'finish', runId, fedFindings: fed, usage, exclusions: run.exclusions.length });
  emit('finished', { runId, fedFindings: fed });
  return run;
}
