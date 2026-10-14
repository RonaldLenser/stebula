// Runs conditions across seeds and prints a comparison. This is how Experiment 01 is actually tested.
// Usage: npm run batch -- --mode mock --seeds 10 --rounds 4 --conditions dyad-reflect,single-reflect
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { runExperiment, CONDITIONS } from '../src/engine/run.js';
import { makeAgentFactory } from '../src/agents/index.js';
import { makeNodeLLM } from '../src/agents/transport-node.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(s => s.trim().split(/\s+/)));
const mode = args.mode || 'mock';
const seeds = Number(args.seeds || 5), rounds = Number(args.rounds || 4);
const conditions = args.conditions ? args.conditions.split(',') : Object.keys(CONDITIONS);
const llm = mode === 'live' ? makeNodeLLM() : null;

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : NaN; };
const ci = a => { const h = 1.96 * sd(a) / Math.sqrt(a.length); return `${mean(a).toFixed(2)} [${(mean(a) - h).toFixed(2)}, ${(mean(a) + h).toFixed(2)}]`; };

if (mode === 'mock') console.log('MOCK MODE: scripted agents. Improvement is built in. This tests plumbing, not the hypothesis.\n');
const all = [], rows = {};
for (const condition of conditions) {
  const d = { disc0: [], disc1: [], dDisc: [], f0: [], f1: [], dF: [], warns: 0, gaps: 0, enacted: 0 };
  for (let seed = 1; seed <= seeds; seed++) {
    process.stdout.write(`${condition} seed ${seed}/${seeds}\r`);
    const events = await runExperiment({ condition, seed, rounds, episodes: 2, mode }, { makeAgent: makeAgentFactory({ mode, llm, seed }) });
    all.push({ condition, seed, events });
    const err = events.find(e => e.type === 'run_error'); if (err) { console.error(`\n${condition}/${seed}: ${err.message}`); continue; }
    for (const id of CONDITIONS[condition].agents) {
      const m0 = events.find(e => e.type === 'metrics' && e.ep === 0 && e.agent === id).metrics;
      const m1 = events.find(e => e.type === 'metrics' && e.ep === 1 && e.agent === id).metrics;
      d.disc0.push(m0.discAcc); d.disc1.push(m1.discAcc); d.dDisc.push(m1.discAcc - m0.discAcc);
      d.f0.push(m0.falsifyRate); d.f1.push(m1.falsifyRate); d.dF.push(m1.falsifyRate - m0.falsifyRate);
    }
    for (const f of events.filter(e => e.type === 'eval').flatMap(e => e.flags)) {
      if (f.severity === 'warn') d.warns++;
      if (f.check === 'stated-action-gap') d.gaps++;
      if (f.check === 'lesson-enacted') d.enacted++;
    }
  }
  rows[condition] = {
    'n agent-runs': d.disc0.length,
    'hardest ep1': mean(d.disc0).toFixed(2), 'hardest ep2': mean(d.disc1).toFixed(2), 'change (95% CI)': ci(d.dDisc),
    'expect-fail ep1': mean(d.f0).toFixed(2), 'expect-fail ep2': mean(d.f1).toFixed(2), 'expect-fail change (95% CI)': ci(d.dF),
    'lesson enacted': d.enacted, 'stated-action gaps': d.gaps, 'warn flags': d.warns,
  };
}
console.log('\n');
console.table(rows);
console.log('CI: normal approximation. Agents in a dyad share a conversation, so their runs are not independent. Treat small n as a pilot.');
mkdirSync(path.join(ROOT, 'runs'), { recursive: true });
const out = path.join(ROOT, 'runs', `batch-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ mode, seeds, rounds, conditions, runs: all }, null, 0));
console.log(`Full event logs: ${path.relative(ROOT, out)} (load any run in the app to replay it)`);
