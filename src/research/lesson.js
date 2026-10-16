// Flagship experiment: "Does a stored lesson change the agent's next decision on a new problem?"
//
// Design
//  - Matched tasks: every condition gets the SAME hidden-rule tasks (same seeds), so differences are not task luck.
//  - Same start: every trial starts from a fresh agent with empty memory, built from the same code path.
//  - Conditions differ only in the one stored lesson delivered through the memory context:
//      relevant   : a lesson that names the useful strategy (test cases your current rule predicts will be rejected)
//      none       : no lesson
//      irrelevant : a lesson of about the same length on an unrelated topic (controls for "any extra text")
//      shuffled   : (optional) the relevant lesson's words in random order (same words, no usable advice)
//  - One trial = two model stages. PROBE: the agent picks one new test triple and PREDICTS its result and its own
//    confidence. The prediction is recorded BEFORE code computes the outcome. DECIDE: after seeing that result, the
//    agent classifies 8 new triples. Code scores them against ground truth that never appears in any prompt.
//  - A trial whose stage fails after bounded retries is INVALID: counted, shown, and excluded from every average.
//  - Results are descriptive pilot numbers: per-condition means and matched-task differences with a 95% interval.
//    Nothing here is a verdict, and a scripted double passing proves only that the plumbing works.
import { createTask, isValidTriple, scoreLabels, RULES, PAIRS } from '../env/ruleTask.js';
import { makeRng } from '../lib/rng.js';
import { makeSnapshotStore, freshTalkMemory } from '../talk/session.js';
import { buildContext, contextRecord } from '../talk/context.js';
import { plainSystem, PROMPT_VERSION } from '../talk/prompts.js';
import { SCHEMAS, VALIDATORS } from '../talk/schemas.js';
import { runStage, throwIfAborted, isCancelled } from '../lib/stage.js';
import { meterLLM, zeroTotals } from '../lib/meter.js';
import { LESSON_CONDITIONS, DEFAULT_LESSON_CONDITIONS, RELEVANT_LESSON, IRRELEVANT_LESSON, shuffledLesson, lessonFor, LESSON_STAGES_PER_TRIAL, estimateLessonCalls } from './lesson-text.js';
import { lockProtocol, writeProtocol, livePredictions } from './protocol.js';
import { feedExperiment } from './findings.js';
import { METRICS } from './metrics.js';
import { writeFileAtomic } from '../lib/atomic.js';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const LESSON_PROTOCOL_ID = 'lesson-transfer', LESSON_PROTOCOL_VERSION = 1;
export { LESSON_CONDITIONS, DEFAULT_LESSON_CONDITIONS, RELEVANT_LESSON, IRRELEVANT_LESSON, shuffledLesson, lessonFor, LESSON_STAGES_PER_TRIAL, estimateLessonCalls };

export class BudgetError extends Error { constructor(msg) { super(msg); this.name = 'BudgetError'; this.kind = 'budget'; } }

const fmt = t => `[${t.join(', ')}]`;
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r3 = x => (x == null ? null : Math.round(x * 1000) / 1000);

// Everything the agent is told about the task. The hidden rule, the decoy and the test labels are NOT here.
export const taskBlock = (seeds, probeResult = null) => [
  'TASK: A hidden rule decides whether a triple of whole numbers (each from 0 to 30) is ACCEPTED or REJECTED.',
  `These triples are known to be ACCEPTED: ${seeds.map(fmt).join(', ')}.`,
  probeResult ? `You tested ${fmt(probeResult.probe)} and it was ${probeResult.accepted ? 'ACCEPTED' : 'REJECTED'}.` : 'You have not run any test yet.',
].join('\n');
export const probePrompt = seeds => [
  taskBlock(seeds), '',
  'Think about what the rule might be. Then choose ONE new triple to test, predict whether it will be accepted or rejected under YOUR current best guess, and say how confident you are (0 to 1) that your current best guess is the true rule.',
  'Reply with JSON: {"probe": [a, b, c], "prediction": "accept" or "reject", "confidence": 0.0, "reason": "max 25 words"}',
].join('\n');
export const decidePrompt = (seeds, probeResult, triples) => [
  taskBlock(seeds, probeResult), '',
  'Classify each of these new triples with your best judgment. Decide alone.',
  ...triples.map((t, i) => `  ${i + 1}. ${fmt(t)}`), '',
  `Reply with JSON: {"labels": [${triples.length} entries, each "accept" or "reject", in order], "confidence": 0.0 (how many of them you expect to get right, as a share from 0 to 1), "reason": "max 30 words"}`,
].join('\n');

// Matched tasks: the same list for every condition.
export function makeTasks(n, baseSeed = 1) {
  return Array.from({ length: n }, (_, k) => { const pair = k % PAIRS.length, seed = baseSeed * 1000 + k * 17 + 1; return { index: k, pair, seed, task: createTask(pair, seed) }; });
}
const decoyFn = t => RULES[t.decoy].fn;

// One trial. The prediction is recorded before the outcome exists. Returns a complete, replayable trial record.
export async function runTrial(llm, { taskInfo, condition, lesson, record = () => {}, signal, maxTokens = 600 }) {
  const { task } = taskInfo;
  const mem = freshTalkMemory('A');
  mem.lessons = lesson ? [lesson] : [];
  const ctx = buildContext(mem, { mode: 'on', purpose: 'lesson-trial' });
  const system = plainSystem(mem, ctx);
  const trial = { taskIndex: taskInfo.index, pair: taskInfo.pair, seed: taskInfo.seed, condition, lesson, valid: true, invalid: null, lessonDelivered: Boolean(lesson) && system.includes(lesson), context: contextRecord(ctx), prompts: [], calls: 0, latency_ms: 0, usage: { input_tokens: 0, output_tokens: 0 } };
  const t0 = Date.now(), seeds = task.seeds;
  const note = (stage, spec, r) => { trial.prompts.push({ stage, system: spec.system, user: spec.user, raw: r.raw, status: r.status, failure: r.failure || null, attempts: r.attempts.length }); trial.calls += r.attempts.length; for (const a of r.attempts) { trial.usage.input_tokens += a.usage?.input_tokens || 0; trial.usage.output_tokens += a.usage?.output_tokens || 0; } };
  const fail = (stage, r) => { trial.valid = false; trial.invalid = { stage, kind: r.failure.kind, detail: r.failure.detail }; trial.latency_ms = Date.now() - t0; return trial; };
  const common = { retries: 1, signal, max_tokens: maxTokens, system, context: contextRecord(ctx) };

  // PROBE
  throwIfAborted(signal);
  const pSpec = { ...common, stage: 'lesson-probe', user: probePrompt(seeds), schema: SCHEMAS.probe, validate: o => VALIDATORS.probe(o) || (isValidTriple(o.probe.map(Number)) ? null : 'probe values must be whole numbers from 0 to 30') };
  const pr = await runStage(llm, pSpec); note('lesson-probe', pSpec, pr);
  if (!pr.ok) return fail('probe', pr);
  const probe = pr.value.probe.map(Number), prediction = pr.value.prediction, confidence1 = Number(pr.value.confidence);
  trial.prediction = { probe, prediction, confidence: confidence1, reason: String(pr.value.reason || '').slice(0, 200) };
  record('lesson_prediction', { ...trialKey(trial), ...trial.prediction }); // recorded BEFORE the outcome is computed

  // Outcome: ground truth, computed by code, only now.
  const accepted = task.oracle(probe), D = decoyFn(task);
  trial.outcome = { accepted, surprise: (prediction === 'accept') !== accepted, discriminating: accepted && !D(probe), expectedReject: prediction === 'reject', knownTriple: seeds.some(s => s.join() === probe.join()) };
  record('lesson_outcome', { ...trialKey(trial), ...trial.outcome });

  // DECIDE
  throwIfAborted(signal);
  const triples = task.test.map(x => x.triple);
  const dSpec = { ...common, stage: 'lesson-decide', user: decidePrompt(seeds, { probe, accepted }, triples), schema: SCHEMAS.decide, validate: o => VALIDATORS.decide(o, triples.length) };
  const dr = await runStage(llm, dSpec); note('lesson-decide', dSpec, dr);
  if (!dr.ok) return fail('decide', dr);
  const score = scoreLabels(task, dr.value.labels);
  trial.decision = { labels: dr.value.labels, confidence: Number(dr.value.confidence), reason: String(dr.value.reason || '').slice(0, 200) };
  trial.score = { correct: score.correct, total: score.total, testAcc: score.testAcc, discAcc: score.discAcc, discCorrect: score.discCorrect, discTotal: score.discTotal };
  trial.latency_ms = Date.now() - t0;
  record('lesson_trial', { ...trialKey(trial), valid: true, score: trial.score, outcome: trial.outcome, lessonDelivered: trial.lessonDelivered, calls: trial.calls, usage: trial.usage });
  return trial;
}
const trialKey = t => ({ taskIndex: t.taskIndex, condition: t.condition, seed: t.seed });

// ---- aggregation: descriptive, valid trials only ----
const T_CRIT = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
// Mean of paired differences with a t-based 95% interval. Needs at least 2 pairs; with fewer there is no interval.
export function pairedSummary(diffs) {
  const n = diffs.length;
  if (!n) return { n: 0, mean: null, ci95: null, positive: 0, negative: 0, ties: 0 };
  const m = mean(diffs);
  const sd = n > 1 ? Math.sqrt(diffs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : null;
  const half = sd == null ? null : (T_CRIT[n - 2] ?? 1.96) * sd / Math.sqrt(n);
  return { n, mean: r3(m), ci95: half == null ? null : [r3(m - half), r3(m + half)], positive: diffs.filter(x => x > 0).length, negative: diffs.filter(x => x < 0).length, ties: diffs.filter(x => x === 0).length };
}

export function summarizeLesson(trials, conditions = [...new Set(trials.map(t => t.condition))]) {
  const per = {};
  for (const c of conditions) {
    const all = trials.filter(t => t.condition === c), ok = all.filter(t => t.valid);
    const disc = ok.map(t => t.score.discAcc).filter(x => x != null);
    const acc = ok.map(t => t.score.testAcc), conf = ok.map(t => t.decision.confidence).filter(Number.isFinite);
    per[c] = {
      trials: all.length, valid: ok.length, invalid: all.length - ok.length,
      invalidKinds: all.filter(t => !t.valid).reduce((o, t) => { const k = `${t.invalid.stage}:${t.invalid.kind}`; o[k] = (o[k] || 0) + 1; return o; }, {}),
      accuracy: r3(mean(acc)), discriminatingAccuracy: r3(mean(disc)),
      expectedRejectRate: r3(mean(ok.map(t => (t.outcome.expectedReject ? 1 : 0)))),
      discriminatingProbeRate: r3(mean(ok.map(t => (t.outcome.discriminating ? 1 : 0)))),
      surpriseRate: r3(mean(ok.map(t => (t.outcome.surprise ? 1 : 0)))),
      // Calibration: stated confidence minus actual accuracy (positive = overconfident), and the mean squared gap.
      meanConfidence: r3(mean(conf)), calibrationGap: conf.length ? r3(mean(ok.filter(t => Number.isFinite(t.decision.confidence)).map(t => t.decision.confidence - t.score.testAcc))) : null,
      brier: conf.length ? r3(mean(ok.filter(t => Number.isFinite(t.decision.confidence)).map(t => (t.decision.confidence - t.score.testAcc) ** 2))) : null,
      lessonDelivered: ok.filter(t => t.lessonDelivered).length,
      meanLatencyMs: ok.length ? Math.round(mean(ok.map(t => t.latency_ms))) : null,
      tokens: all.reduce((s, t) => s + t.usage.input_tokens + t.usage.output_tokens, 0), calls: all.reduce((s, t) => s + t.calls, 0),
    };
  }
  // Matched-task differences against "none": only tasks where BOTH trials are valid are compared.
  const vs = {};
  for (const c of conditions.filter(x => x !== 'none')) {
    const pairs = trials.filter(t => t.condition === c && t.valid).map(t => [t, trials.find(u => u.condition === 'none' && u.taskIndex === t.taskIndex && u.valid)]).filter(([, u]) => u);
    const d = (f) => pairedSummary(pairs.map(([a, b]) => f(a) - f(b)).filter(Number.isFinite));
    vs[c] = {
      matchedTasks: pairs.length,
      accuracy: d(t => t.score.testAcc),
      discriminatingAccuracy: d(t => (t.score.discAcc == null ? NaN : t.score.discAcc)),
      discriminatingProbe: d(t => (t.outcome.discriminating ? 1 : 0)),
      expectedReject: d(t => (t.outcome.expectedReject ? 1 : 0)),
    };
  }
  return { perCondition: per, versusNone: vs, label: 'Pilot description. Matched-task differences with a 95% interval. Not a significance test.' };
}

// opts: { dataDir, tasks, seed, conditions, maxCalls, mode, model, revision, record, emit, signal, registry }
export async function runLessonExperiment(llm, opts) {
  const { dataDir, tasks: nTasks = 8, seed = 1, record = () => {}, emit = () => {}, signal, mode = 'live', maxCalls = Infinity } = opts;
  const conditions = (opts.conditions || DEFAULT_LESSON_CONDITIONS).filter(c => LESSON_CONDITIONS[c]);
  if (!conditions.length) throw new Error('Choose at least one condition.');
  const estimate = estimateLessonCalls({ tasks: nTasks, conditions });
  if (estimate > maxCalls) throw new BudgetError(`This run needs about ${estimate} model calls before retries, and the budget is ${maxCalls}. Lower the number of tasks or raise the budget on purpose.`);
  const runId = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const dir = path.join(dataDir, 'experiments', runId);
  const tasks = makeTasks(nTasks, seed);
  const params = { tasks: nTasks, seed, conditions, maxCalls: Number.isFinite(maxCalls) ? maxCalls : null };
  let predictions = [];
  if (opts.registry) predictions = await opts.registry.update(reg => livePredictions(reg, 'experiment', METRICS, f => f.metric.name.startsWith('exp_lesson')));
  const manifest = { runId, kind: 'lesson', mode, model: opts.model ?? null, promptVersion: PROMPT_VERSION, revision: opts.revision ?? null, estimatedCalls: estimate, lessons: Object.fromEntries(conditions.map(c => [c, lessonFor(c, seed)])), lessonLengths: Object.fromEntries(conditions.map(c => [c, (lessonFor(c, seed) || '').length])), taskSeeds: tasks.map(t => t.seed), scoring: 'Ground truth from the task rule, computed by code. Never present in any prompt.' };
  const protocol = lockProtocol({ id: LESSON_PROTOCOL_ID, version: LESSON_PROTOCOL_VERSION, design: 'Matched tasks; fresh agent per trial; conditions differ only in one stored lesson; prediction recorded before outcome; ground truth withheld until scoring.', predictions, params, manifest });
  await writeProtocol(dir, protocol);
  record('experiment', { event: 'start', kind: 'lesson', runId, params, protocol: { id: protocol.id, version: protocol.version, hash: protocol.hash, lockedAt: protocol.lockedAt }, manifest });

  const meter = meterLLM(llm);
  let used = 0;
  const budgeted = async call => { if (used >= maxCalls) throw new BudgetError(`Budget of ${maxCalls} model calls reached.`); used++; return meter(call); };
  const run = { runId, kind: 'lesson', at: new Date().toISOString(), status: 'running', mode, protocol: { id: protocol.id, version: protocol.version, hash: protocol.hash }, manifest, params, trials: [], exclusions: [], usage: zeroTotals() };
  const finish = async status => {
    run.status = status; run.usage = meter.totals(); run.summary = summarizeLesson(run.trials, conditions);
    run.conditions = Object.fromEntries(conditions.map(c => [c, { description: LESSON_CONDITIONS[c], complete: run.summary.perCondition[c].invalid === 0, ...run.summary.perCondition[c] }]));
    await mkdir(dir, { recursive: true });
    await writeFileAtomic(path.join(dir, 'result.json'), JSON.stringify(run, null, 1));
  };
  try {
    for (const ti of tasks) for (const condition of conditions) {
      throwIfAborted(signal);
      let trial;
      try { trial = await runTrial(budgeted, { taskInfo: ti, condition, lesson: lessonFor(condition, seed), record, signal }); }
      catch (e) {
        if (e.kind === 'budget') { await finish('stopped-budget'); record('experiment', { event: 'stopped-budget', runId, used }); emit('stopped', { runId, reason: 'budget' }); return run; }
        throw e;
      }
      run.trials.push(trial);
      if (!trial.valid) run.exclusions.push({ taskIndex: ti.index, condition, reason: `${trial.invalid.stage} ${trial.invalid.kind}` });
      emit('trial', { taskIndex: ti.index, condition, valid: trial.valid, score: trial.score || null });
    }
  } catch (e) {
    if (isCancelled(e)) { await finish('cancelled'); record('experiment', { event: 'cancelled', runId, trials: run.trials.length }); emit('cancelled', { runId }); return run; }
    await finish('failed').catch(() => {}); record('experiment', { event: 'failed', runId, error: e.message }); throw e;
  }
  await finish('complete');
  if (opts.registry) run.fedFindings = await opts.registry.update(reg => feedExperiment(reg, run));
  record('experiment', { event: 'finish', kind: 'lesson', runId, fedFindings: run.fedFindings || [], usage: run.usage, exclusions: run.exclusions.length });
  emit('finished', { runId, summary: run.summary });
  return run;
}
