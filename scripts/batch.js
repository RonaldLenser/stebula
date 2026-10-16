// Runs conditions across seeds and prints a comparison. This is how Experiment 01 is actually tested.
// Usage: npm run batch -- --mode mock --seeds 10 --rounds 4 --conditions dyad-reflect,single-reflect
// Live runs need a budget on purpose: npm run batch -- --mode live --seeds 3 --max-calls 400
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { runExperiment, CONDITIONS } from '../src/engine/run.js';
import { runValues, summarizeRuns } from '../src/engine/analyze.js';
import { estimateBatchCalls } from '../src/engine/estimate.js';
import { makeAgentFactory } from '../src/agents/index.js';
import { makeNodeLLM } from '../src/agents/transport-node.js';
import { meterLLM } from '../src/lib/meter.js';
import { codeRevision } from '../src/lib/revision.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(s => s.trim().split(/\s+/)));
const mode = args.mode || 'mock';
const seeds = Number(args.seeds || 5), rounds = Number(args.rounds || 4);
const conditions = args.conditions ? args.conditions.split(',') : Object.keys(CONDITIONS);
const estimate = estimateBatchCalls({ conditions, seeds, rounds });
const maxCalls = args['max-calls'] ? Number(args['max-calls']) : null;
console.log(`Plan: ${conditions.length} condition(s) x ${seeds} seed(s) x ${rounds} round(s) = ${estimate} model calls before retries.`);
if (mode === 'live' && !(maxCalls > 0)) { console.error('A live batch needs an explicit budget: add --max-calls N. Nothing was run.'); process.exit(2); }
if (mode === 'live' && estimate > maxCalls) { console.error(`That needs about ${estimate} calls and the budget is ${maxCalls}. Lower --seeds, or raise --max-calls on purpose. Nothing was run.`); process.exit(2); }
const meter = mode === 'live' ? meterLLM(makeNodeLLM()) : null;
let used = 0;
const llm = meter ? async c => { if (used++ >= maxCalls) throw new Error('call budget reached'); return meter(c); } : null;
const revision = codeRevision(ROOT);

if (mode === 'mock') console.log('MOCK MODE: scripted agents. Improvement is built in. This tests plumbing, not the hypothesis.\n');
const all = [], runs = [];
for (const condition of conditions) {
  for (let seed = 1; seed <= seeds; seed++) {
    process.stdout.write(`${condition} seed ${seed}/${seeds}\r`);
    const manifest = { mode, model: process.env.MODEL || null, revision, condition, seed, rounds, episodes: 2 };
    const events = await runExperiment({ condition, seed, rounds, episodes: 2, mode }, { makeAgent: makeAgentFactory({ mode, llm, seed }), manifest });
    all.push({ condition, seed, events });
    const err = events.find(e => e.type === 'run_error'); if (err) console.error(`\n${condition}/${seed}: ${err.message} (this run is excluded)`);
    runs.push({ condition, seed, values: runValues(events) });
  }
}
const s = summarizeRuns(runs);
const f = x => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const ci = i => `${f(i.mean)} [${f(i.lo)}, ${f(i.hi)}]`;
console.log('\n');
console.table(Object.fromEntries(Object.entries(s).map(([c, r]) => [c, {
  'runs': r.runs, 'invalid runs': r.invalidRuns,
  'hardest ep1': f(r.disc0), 'hardest ep2': f(r.disc1), 'change (95% CI across runs)': ci(r.dDisc),
  'expect-fail ep1': f(r.f0), 'expect-fail ep2': f(r.f1), 'expect-fail change (95% CI)': ci(r.dF),
  'lesson enacted': r.enacted, 'stated-action gaps': r.gaps, 'warn flags': r.warns,
}])));
console.log('The unit is the run. Agents in a dyad talk to each other, so a dyad run counts once (the mean of its agents). Treat small n as a pilot, not a test.');
if (meter) console.log('Usage:', JSON.stringify(meter.totals()));
mkdirSync(path.join(ROOT, 'runs'), { recursive: true });
const out = path.join(ROOT, 'runs', `batch-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ manifest: { mode, model: process.env.MODEL || null, revision, seeds, rounds, conditions, estimatedCalls: estimate, usage: meter?.totals() ?? null, excludedRuns: runs.filter(r => !r.values).map(r => `${r.condition}/${r.seed}`) }, summary: s, runs: all }, null, 0));
console.log(`Full event logs: ${path.relative(ROOT, out)} (load any run in the app to replay it)`);
