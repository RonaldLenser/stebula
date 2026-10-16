// Metrics the code can compute. A hypothesis is only "testable by code" if its metric is in this list.
// Every number comes from stored memory or from an experiment run; nothing here asks the model anything.
import { buildItems, measureProxy, saidVsShown, sameName, STATED_FLOOR } from '../talk/personality.js';

const r3 = x => Math.round(x * 1000) / 1000;
// opts.since (ISO time): measure only data recorded after it. Metrics marked `since: true` support this, which is how
// a finding is tested on data collected AFTER its prediction was locked.
const after = (list, since) => (since ? list.filter(x => x.at > since) : list);
const proxy = key => (mems, agent, o = {}) => { const m = measureProxy(key, after(mems[agent].archive, o.since)); return m.value == null ? null : { value: m.value, n: m.n }; };

export const STAT_METRICS = {
  questions_per_turn: { since: true, label: 'Share of replies that contain a question', compute: proxy('questions') },
  challenge_rate: { since: true, label: 'Share of replies that push back on the person', compute: proxy('challenges') },
  hedging_rate: { since: true, label: 'Share of replies with hedging language', compute: proxy('hedging') },
  memory_reference_rate: { since: true, label: 'Share of replies that refer to earlier conversation or memory', compute: proxy('memory') },
  initiative_win_rate: { since: true, label: 'Share of turns where the initiative thought won the workspace', compute: proxy('initiative') },
  selfpredict_accuracy: {
    since: true,
    label: 'Share of self-prediction tests where both fresh answers matched the prediction',
    compute: (mems, agent, o = {}) => { const all = after(mems[agent].selfTests, o.since), t = all.filter(x => x.match !== 'invalid'); return t.length ? { value: r3(t.filter(x => x.match === 'yes').length / t.length), n: t.length, invalid: all.length - t.length } : null; },
  },
  revision_rate: {
    since: true,
    label: 'Self-model revisions per Talk turn',
    compute: (mems, agent, o = {}) => { const m = mems[agent], turns = after(m.archive, o.since).filter(x => x.role === 'assistant' && x.kind !== 'opening' && !x.degraded).length; return turns ? { value: r3(after(m.revisions, o.since).filter(r => !String(r.trigger).startsWith('(')).length / turns), n: turns } : null; },
  },
  trait_behavior_backed: {
    label: 'Share of measurable stated traits (strength 0.3 or more) that behavior backs',
    compute: (mems, agent) => {
      const m = mems[agent], rows = buildItems(m.personality).filter(i => i.kind === 'trait' && i.strength >= STATED_FLOOR).map(i => saidVsShown(i, m.archive)).filter(s => s.proxy && s.n >= 3);
      return rows.length ? { value: r3(rows.filter(s => !s.flagged).length / rows.length), n: rows.length } : null;
    },
  },
  baseline_trait_overlap: {
    label: 'Share of the agent\'s personality items that also appear in the empty-memory baseline',
    compute: (mems, agent) => {
      const m = mems[agent], items = buildItems(m.personality), base = m.baseline ? buildItems(m.baseline.personality) : null;
      return base && items.length ? { value: r3(items.filter(i => base.some(b => sameName(i, b))).length / items.length), n: items.length } : null;
    },
  },
  ab_trait_divergence: {
    label: 'One minus the share of personality items that Agent A and Agent B have in common',
    agents: 'both',
    compute: mems => {
      const a = buildItems(mems.A.personality), b = buildItems(mems.B.personality), union = a.length + b.length;
      if (!a.length || !b.length) return null;
      const shared = a.filter(x => b.some(y => sameName(x, y))).length;
      return { value: r3(1 - shared / (union - shared)), n: union - shared };
    },
  },
};

// Experiment metrics take one finished isolation-experiment run and return one value for it.
// An incomplete condition (a step or checkpoint failed after retries) contributes nothing: a failed mechanism is not a trial.
const last = run => c => { const x = run.conditions?.[c]; return x?.checkpoints && x.complete !== false ? x.checkpoints.filter(cp => !cp.failed).at(-1) || null : null; };
const acc = cp => (cp?.selfpredict?.n ? cp.selfpredict.yes / cp.selfpredict.n : null);
export const EXP_METRICS = {
  exp_traits_isolated_minus_social: {
    label: 'Personality traits expressed in the final answers: reading-only agent minus conversation-only agent',
    compute: run => { const f = last(run), i = f('isolated'), s = f('social'); return i && s ? { value: i.traits.length - s.traits.length, n: 1 } : null; },
  },
  exp_mixed_baseline_overlap: {
    label: 'Share of the mixed agent\'s final traits that the no-input baseline also expressed',
    compute: run => {
      const f = last(run), m = f('mixed'), b = f('baseline');
      return m && b && m.traits.length ? { value: r3(m.traits.filter(t => b.traits.some(x => sameName(t, x))).length / m.traits.length), n: 1 } : null;
    },
  },
  exp_selfpredict_mixed_minus_baseline: {
    label: 'Self-prediction accuracy at the final checkpoint: mixed agent minus baseline agent',
    compute: run => { const f = last(run), m = acc(f('mixed')), b = acc(f('baseline')); return m != null && b != null ? { value: r3(m - b), n: 1 } : null; },
  },
};

// The flagship lesson experiment: matched-task difference in accuracy on the hardest items, relevant lesson minus no lesson.
EXP_METRICS.exp_lesson_disc_relevant_minus_none = {
  label: 'Lesson experiment: accuracy on the hardest test items, relevant-lesson condition minus no-lesson condition (matched tasks)',
  compute: run => { const d = run.kind === 'lesson' && run.summary?.versusNone?.relevant?.discriminatingAccuracy; return d && d.n >= 2 && d.mean != null ? { value: d.mean, n: 1 } : null; },
};

export const METRICS = { ...Object.fromEntries(Object.entries(STAT_METRICS).map(([k, v]) => [k, { ...v, source: 'stats' }])), ...Object.fromEntries(Object.entries(EXP_METRICS).map(([k, v]) => [k, { ...v, source: 'experiment' }])) };
export const COMPARATORS = { '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b };
export const catalog = () => Object.entries(METRICS).map(([name, m]) => ({ name, label: m.label, source: m.source, agents: m.agents || (m.source === 'stats' ? 'each' : 'run') }));

// All stats-based metrics for both agents, for the hypothesis generator to read.
export function aggregateStats(mems) {
  const out = {};
  for (const [name, m] of Object.entries(STAT_METRICS)) {
    for (const agent of m.agents === 'both' ? ['both'] : ['A', 'B']) {
      const v = m.compute(mems, agent);
      if (v) out[agent === 'both' ? name : `${name}[${agent}]`] = v;
    }
  }
  return out;
}
