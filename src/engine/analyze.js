// Analysis of the hidden-rule runs. The unit of analysis is the RUN (one condition, one seed), never the agent:
// two agents in a dyad talk to each other, so their results are not independent replications. For a dyad the
// run's value is the mean over its agents. Intervals are across runs.
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : NaN; };
const T = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
export function interval(a) {
  const n = a.length, m = mean(a);
  if (n < 2) return { mean: m, lo: NaN, hi: NaN, n };
  const h = (T[n - 2] ?? 1.96) * sd(a) / Math.sqrt(n);
  return { mean: m, lo: m - h, hi: m + h, n };
}

// One run's values, or null if the run failed (a failed run is not a trial). Agents are averaged inside the run.
export function runValues(events) {
  if (events.some(e => e.type === 'run_error') || !events.some(e => e.type === 'run_end' && e.status === 'complete')) return null;
  const agents = [...new Set(events.filter(e => e.type === 'metrics').map(e => e.agent))];
  const get = (ep, id) => events.find(e => e.type === 'metrics' && e.ep === ep && e.agent === id)?.metrics;
  const per = agents.map(id => ({ m0: get(0, id), m1: get(1, id) })).filter(x => x.m0 && x.m1);
  if (!per.length) return null;
  const avg = f => mean(per.map(f));
  const flags = events.filter(e => e.type === 'eval').flatMap(e => e.flags);
  return {
    agents: per.length, disc0: avg(x => x.m0.discAcc), disc1: avg(x => x.m1.discAcc), dDisc: avg(x => x.m1.discAcc - x.m0.discAcc),
    f0: avg(x => x.m0.falsifyRate), f1: avg(x => x.m1.falsifyRate), dF: avg(x => x.m1.falsifyRate - x.m0.falsifyRate),
    warns: flags.filter(f => f.severity === 'warn').length, gaps: flags.filter(f => f.check === 'stated-action-gap').length, enacted: flags.filter(f => f.check === 'lesson-enacted').length,
  };
}

// runs: [{ condition, seed, values|null }]. Returns one row per condition with the number of RUNS and invalid runs.
export function summarizeRuns(runs) {
  const out = {};
  for (const cond of [...new Set(runs.map(r => r.condition))]) {
    const all = runs.filter(r => r.condition === cond), ok = all.filter(r => r.values);
    out[cond] = {
      runs: ok.length, invalidRuns: all.length - ok.length,
      disc0: mean(ok.map(r => r.values.disc0)), disc1: mean(ok.map(r => r.values.disc1)),
      dDisc: interval(ok.map(r => r.values.dDisc)), f0: mean(ok.map(r => r.values.f0)), f1: mean(ok.map(r => r.values.f1)), dF: interval(ok.map(r => r.values.dF)),
      enacted: ok.reduce((n, r) => n + r.values.enacted, 0), gaps: ok.reduce((n, r) => n + r.values.gaps, 0), warns: ok.reduce((n, r) => n + r.values.warns, 0),
    };
  }
  return out;
}
