// Findings registry (data/findings.json). The prediction, metric, and refutation condition are locked when a
// finding is created. Nothing locked can be edited; a change creates a new version with no inherited results.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { extractJson } from '../agents/parse.js';
import { METRICS, COMPARATORS, aggregateStats, catalog } from './metrics.js';
import { HUMAN_AREAS } from './human.js';

export const STATUSES = ['proposed', 'testing', 'supported', 'refuted', 'inconclusive'];
const LOCKED = ['statement', 'prediction', 'metric', 'refutedIf'];
const str = (x, n = 400) => (x == null ? '' : String(x)).trim().slice(0, n);
const r3 = x => Math.round(x * 1000) / 1000;
const lockHash = f => createHash('sha256').update(JSON.stringify(LOCKED.map(k => f[k]))).digest('hex').slice(0, 16);

export const freshRegistry = () => ({ format: 'stebula-findings/1', seq: 0, findings: [] });
export async function loadRegistry(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return freshRegistry(); } }
export async function saveRegistry(file, reg) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(reg, null, 1)); }

const label = f => `${f.id} v${f.version}`;
export const findingKey = f => `${f.id}@${f.version}`;
export const current = (reg, id) => reg.findings.filter(f => f.id === id).sort((a, b) => b.version - a.version)[0] || null;

// Build one finding from a proposal. Computable metrics need a numeric prediction; anything else needs a design.
export function normalizeProposal(p) {
  const statement = str(p?.statement, 400);
  if (!statement) throw new Error('A finding needs a statement.');
  const name = str(p?.metric?.name, 60);
  const computable = Boolean(METRICS[name]);
  const m = computable ? METRICS[name] : null;
  const metric = { name: computable ? name : 'custom', agent: m?.source === 'stats' && m.agents !== 'both' ? (p.metric.agent === 'B' ? 'B' : 'A') : null, description: str(p?.metric?.description, 300) || (m ? m.label : '') };
  let prediction, minN = 0;
  if (computable) {
    const comparator = str(p?.prediction?.comparator, 3), value = Number(p?.prediction?.value);
    if (!COMPARATORS[comparator] || !Number.isFinite(value)) throw new Error('A computable prediction needs a comparator (>, <, >=, <=) and a number.');
    minN = Math.max(1, Math.min(1000, Math.round(Number(p?.prediction?.minN) || (m.source === 'experiment' ? 3 : 5))));
    prediction = { text: str(p?.prediction?.text, 300) || `${m.label} will be ${comparator} ${value}`, comparator, value, minN };
  } else {
    if (!str(p?.prediction?.text)) throw new Error('A prediction is required.');
    prediction = { text: str(p.prediction.text, 300) };
    if (!str(p?.design, 600)) throw new Error('A finding whose metric code cannot compute needs a suggested experiment design.');
  }
  const refutedIf = str(p?.refutedIf, 300) || (computable ? `The measured value is not ${prediction.comparator} ${prediction.value} with at least ${minN} ${m.source === 'experiment' ? 'runs' : 'observations'}.` : '');
  if (!refutedIf) throw new Error('State what result would count against it.');
  return {
    statement, prediction, metric, refutedIf, computable, needsExperiment: !computable, design: computable ? '' : str(p.design, 600),
    humanArea: HUMAN_AREAS[p?.humanArea] ? p.humanArea : null, suggestedBy: Array.isArray(p?.suggestedBy) ? p.suggestedBy.map(String).slice(0, 12) : [],
    origin: p?.origin === 'code' ? 'code' : 'model', key: p?.key ? str(p.key, 60) : null,
  };
}

export function createFinding(reg, proposal, now = new Date().toISOString()) {
  const base = normalizeProposal(proposal);
  const f = { id: `F${++reg.seq}`, version: 1, ...base, status: 'proposed', createdAt: now, lockedAt: now, results: [], supersedes: null, supersededBy: null };
  f.lockHash = lockHash(f);
  reg.findings.push(f);
  return f;
}

// Tamper check: recompute each lock hash. Returns the findings whose locked fields no longer match.
export const verifyLocks = reg => reg.findings.filter(f => f.lockHash !== lockHash(f)).map(findingKey);

// Only unlocked, descriptive fields can change in place, and never once data has arrived for a locked one.
export function editFinding(reg, id, patch) {
  const f = current(reg, id);
  if (!f) throw new Error(`No finding ${id}.`);
  const bad = Object.keys(patch).filter(k => LOCKED.includes(k) || ['results', 'status', 'lockHash', 'lockedAt', 'version'].includes(k));
  if (bad.length) throw new Error(`${label(f)} is locked: ${bad.join(', ')} cannot be edited${f.results.length ? ' after data arrived' : ''}. Revise it to make a new version.`);
  for (const k of ['design', 'humanArea']) if (k in patch) f[k] = k === 'humanArea' ? (HUMAN_AREAS[patch[k]] ? patch[k] : null) : str(patch[k], 600);
  return f;
}

// A change of anything locked creates version N+1. It starts clean: old results do not carry over.
export function reviseFinding(reg, id, changes, now = new Date().toISOString()) {
  const old = current(reg, id);
  if (!old) throw new Error(`No finding ${id}.`);
  const next = normalizeProposal({ ...old, ...changes, metric: { ...old.metric, ...(changes.metric || {}) }, prediction: { ...old.prediction, ...(changes.prediction || {}) }, origin: old.origin });
  const f = { id, version: old.version + 1, ...next, status: 'proposed', createdAt: now, lockedAt: now, results: [], supersedes: findingKey(old), supersededBy: null };
  f.lockHash = lockHash(f);
  old.supersededBy = findingKey(f);
  reg.findings.push(f);
  return f;
}

// Turn the stored results into a status. Stats metrics use the latest observation; experiment metrics pool runs.
export function evaluate(f) {
  if (!f.computable || !f.results.length) return { status: f.status, value: null, n: 0 };
  const exp = METRICS[f.metric.name].source === 'experiment';
  const value = exp ? r3(f.results.reduce((s, r) => s + r.value, 0) / f.results.length) : f.results.at(-1).value;
  const n = exp ? f.results.length : f.results.at(-1).n;
  const status = n < f.prediction.minN ? 'inconclusive' : COMPARATORS[f.prediction.comparator](value, f.prediction.value) ? 'supported' : 'refuted';
  return { status, value, n };
}

function addResult(f, r, now) {
  f.results.push({ ...r, at: now });
  f.status = 'testing';
  const e = evaluate(f);
  f.status = e.status;
  f.results.at(-1).outcome = e.status; f.results.at(-1).pooledValue = e.value; f.results.at(-1).pooledN = e.n;
  return f;
}

// Test one finding against the current memory files. Experiment metrics are tested by feedExperiment instead.
export function testFinding(reg, id, mems, now = new Date().toISOString()) {
  const f = current(reg, id);
  if (!f) throw new Error(`No finding ${id}.`);
  if (!f.computable) throw new Error(`${label(f)} needs an experiment: ${f.design}`);
  const m = METRICS[f.metric.name];
  if (m.source !== 'stats') throw new Error(`${label(f)} is tested by running the isolation experiment, not from stored memory.`);
  const v = m.compute(mems, f.metric.agent);
  if (!v) throw new Error('There is no data for this metric yet.');
  return addResult(f, { value: v.value, n: v.n, agent: f.metric.agent }, now);
}

// An experiment run feeds every live finding that uses an experiment metric.
export function feedExperiment(reg, run, now = new Date().toISOString()) {
  const fed = [];
  for (const f of reg.findings) {
    if (f.supersededBy || !f.computable) continue;
    const m = METRICS[f.metric.name];
    if (m.source !== 'experiment') continue;
    const v = m.compute(run);
    if (!v) continue;
    addResult(f, { value: v.value, n: 1, runId: run.runId }, now);
    fed.push(findingKey(f));
  }
  return fed;
}

// Predictions written by the code, locked before any experiment has run.
export const DEFAULT_EXPERIMENT_FINDINGS = [
  { key: 'exp-iso-traits', statement: 'An agent that only reads expresses more personality traits in its answers than an agent that only converses, after the same number of steps.', metric: { name: 'exp_traits_isolated_minus_social' }, prediction: { comparator: '>', value: 0, minN: 3 }, humanArea: 'social-deprivation' },
  { key: 'exp-mixed-baseline', statement: 'An agent that both reads and converses expresses mostly different traits from the no-input baseline: fewer than half of its final traits also appear in the baseline.', metric: { name: 'exp_mixed_baseline_overlap' }, prediction: { comparator: '<', value: 0.5, minN: 3 }, humanArea: 'personality-heritability' },
  { key: 'exp-selfpredict', statement: 'Self-prediction accuracy is higher for an agent with accumulated memory than for the no-input baseline.', metric: { name: 'exp_selfpredict_mixed_minus_baseline' }, prediction: { comparator: '>', value: 0, minN: 3 }, humanArea: 'introspection-accuracy' },
];
export function ensureDefaultFindings(reg, now) {
  const made = [];
  for (const d of DEFAULT_EXPERIMENT_FINDINGS) if (!reg.findings.some(f => f.key === d.key)) made.push(createFinding(reg, { ...d, origin: 'code' }, now));
  return made;
}

// ---- hypothesis generation: the model proposes, code validates and locks ----
export function hypothesisPrompt(stats, recordRefs) {
  return [
    'You are helping a researcher who studies an AI agent called Stebula. Below are aggregated statistics from its recorded conversations and reading. Propose up to 3 testable hypotheses suggested by them.',
    'Be modest: small samples are anecdotes. Do not propose anything about whether the agent is conscious.',
    '',
    `Aggregated stats (name: value, n): ${JSON.stringify(stats)}`,
    `Metrics code can compute: ${JSON.stringify(catalog().filter(m => m.source === 'stats').map(m => ({ name: m.name, label: m.label, agents: m.agents })))}`,
    `Some record ids you may cite (id: type): ${recordRefs.map(r => `${r.id}: ${r.type}`).join('; ') || 'none'}`,
    `Human research areas you may name: ${Object.keys(HUMAN_AREAS).join(', ')}`,
    '',
    'For each hypothesis give: a statement; suggestedBy (record ids from the list that suggested it, at least one); a prediction fixed BEFORE testing; the metric that tests it; and the result that would refute it.',
    'If a listed metric fits, use it with {"name", "agent": "A" or "B"} and a numeric prediction {"comparator": ">" | "<" | ">=" | "<=", "value": number, "minN": number}. If none fits, use metric {"name": "custom", "description": "..."}, a prediction with only "text", and a "design" describing an experiment that could test it.',
    'Reply with exactly one JSON object: {"hypotheses": [{"statement": "...", "suggestedBy": ["..."], "prediction": {...}, "metric": {...}, "refutedIf": "...", "design": "only for custom", "humanArea": "one of the areas"}]}',
  ].join('\n');
}

export async function generateHypotheses(reg, llm, { mems, records }, now = new Date().toISOString()) {
  const stats = aggregateStats(mems);
  const refs = records.filter(r => ['turn', 'self_test', 'digest', 'personality_change'].includes(r.type)).slice(-40).map(r => ({ id: r.id, type: r.type }));
  if (!Object.keys(stats).length) throw new Error('Not enough recorded data yet. Talk, read, or run self-prediction tests first.');
  const raw = await llm({ system: 'You are a careful research assistant. Reply with JSON only.', user: hypothesisPrompt(stats, refs), max_tokens: 1500, stage: 'hypotheses' });
  const obj = extractJson(raw);
  const known = new Set(records.map(r => r.id));
  const created = [], rejected = [];
  for (const h of Array.isArray(obj?.hypotheses) ? obj.hypotheses.slice(0, 3) : []) {
    const suggestedBy = (Array.isArray(h?.suggestedBy) ? h.suggestedBy : []).map(String).filter(id => known.has(id));
    try {
      if (!suggestedBy.length) throw new Error('No valid record id cited.');
      created.push(createFinding(reg, { ...h, suggestedBy, origin: 'model' }, now));
    } catch (e) { rejected.push({ statement: str(h?.statement, 200), why: e.message }); }
  }
  return { created, rejected, raw };
}
