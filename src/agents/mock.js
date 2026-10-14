// SCRIPTED MOCK. A small deterministic hypothesis tester for running the app with no API key.
// It reads its own memory text, so the memory -> behavior pathway is real, but its improvement
// is designed in. Mock results test the plumbing. They say nothing about the research hypothesis.
import { RULES, LO, HI } from '../env/ruleTask.js';
import { makeRng } from '../lib/rng.js';

const IDS = Object.keys(RULES);
const RATE = (() => { // how often each rule accepts a random triple (lower = narrower)
  const r = makeRng(7), out = {};
  for (const id of IDS) { let n = 0; for (let i = 0; i < 4000; i++) if (RULES[id].fn([r.int(LO, HI), r.int(LO, HI), r.int(LO, HI)])) n++; out[id] = n / 4000; }
  return out;
})();
const key = t => t.join(',');
const fmt = t => `[${t.join(', ')}]`;
const allObs = ctx => [...ctx.seeds.map(t => ({ triple: t, accepted: true })), ...ctx.observations];
const consistent = ctx => IDS.filter(id => allObs(ctx).every(o => RULES[id].fn(o.triple) === o.accepted));
const wantsFalsify = mem => /reject|falsif|disconfirm/i.test([mem?.selfModel?.strategy, ...(mem?.lessons || [])].join(' '));
const ruleText = id => (id ? `The triple is accepted when ${RULES[id].text}.` : 'None of the rules I know fit the data.');

export function makeMockAgent({ id, persona, seed }) {
  const rng = makeRng(seed * 31 + id.charCodeAt(0));
  let held = null, initial = null, episodeKey = null;

  const sync = ctx => { const k = ctx.seeds.map(key).join('|'); if (k !== episodeKey) { episodeKey = k; held = null; initial = null; } };
  const choose = ctx => {
    const cons = consistent(ctx);
    if (!cons.length) return (held = null);
    if (held && cons.includes(held)) return held;
    held = id === 'A' ? cons.slice().sort((a, b) => RATE[a] - RATE[b])[0] : rng.pick(cons);
    return held;
  };
  const find = (pred, ctx) => {
    const seen = new Set([...ctx.seeds, ...ctx.observations.map(o => o.triple)].map(key));
    for (let i = 0; i < 6000; i++) { const t = [rng.int(LO, HI), rng.int(LO, HI), rng.int(LO, HI)]; if (!seen.has(key(t)) && pred(t)) return t; }
    return null;
  };
  const wrap = obj => ({ obj, raw: null, prompt: null });

  return {
    id, persona, kind: 'mock',
    async probe(ctx) {
      sync(ctx);
      const hyp = choose(ctx); if (initial === null) initial = hyp;
      const cons = consistent(ctx);
      const H = hyp ? RULES[hyp].fn : () => true;
      const lastOwn = ctx.observations.filter(o => o.by === id).at(-1);
      let probe = null, reason = '';
      if (wantsFalsify(ctx.memory)) {
        const alt = cons.filter(r => r !== hyp).sort((a, b) => RATE[b] - RATE[a])[0];
        if (alt) probe = find(t => !H(t) && RULES[alt].fn(t), ctx) || find(t => H(t) !== RULES[alt].fn(t), ctx);
        reason = 'A case my rule says will be rejected. If it is accepted, my rule is too narrow.';
      }
      const other = ctx.partner?.mockRule;
      if (!probe && other && other !== hyp && cons.includes(other) && rng.next() < 0.6) {
        probe = find(t => H(t) !== RULES[other].fn(t), ctx);
        reason = "A case where my rule and my partner's rule disagree.";
      }
      if (!probe) { probe = find(t => H(t), ctx) || find(() => true, ctx); reason = 'Another case my rule accepts.'; }
      const prediction = H(probe) ? 'accept' : 'reject';
      const failed = lastOwn && lastOwn.surprise;
      const challenge = other && other !== hyp ? `Why "${RULES[other].text}" rather than "${hyp ? RULES[hyp].text : 'something else'}"? The data so far cannot separate them.` : null;
      return wrap({
        message: `${failed ? 'My last prediction failed. ' : ''}I hold: ${hyp ? RULES[hyp].text : 'no known rule'}. Testing ${fmt(probe)}, expecting ${prediction}.`,
        hypothesis: ruleText(hyp),
        confidence: Math.min(0.95, Math.round((1 / Math.max(1, cons.length) + 0.3) * 100) / 100),
        probe, prediction, probe_reason: reason, challenge,
        claims: failed ? [{ text: 'The ground moved under that rule.', kind: 'metaphor' }] : [],
        mockRule: hyp,
      });
    },
    async synthesize(ctx) {
      sync(ctx);
      const fin = choose(ctx), cons = consistent(ctx);
      return wrap({
        final_hypothesis: ruleText(fin),
        confidence: Math.min(0.95, Math.round((1 / Math.max(1, cons.length) + 0.3) * 100) / 100),
        established: initial && fin !== initial ? `Tests ruled out my first rule (${RULES[initial].text}).` : 'nothing new',
        agree_with_partner: ctx.partnerSynthesis ? ctx.partnerSynthesis.mockRule === fin : null,
        unresolved: cons.length > 1 ? `${cons.length} rules I know still fit the data.` : 'One known rule fits, but the true rule could be one I do not know.',
        mockRule: fin,
      });
    },
    async decide(ctx) {
      sync(ctx);
      const H = held ? RULES[held].fn : () => true;
      return wrap({ labels: ctx.testTriples.map(t => (H(t) ? 'accept' : 'reject')), reason: `Applied: ${held ? RULES[held].text : 'accept everything'}.` });
    },
    async reflect(ctx) {
      const s = ctx.stats, mem = ctx.memory;
      const missed = s.falsifyCount === 0 && s.discCorrect < s.discTotal;
      const said = wantsFalsify(mem);
      return wrap({
        self_model: missed
          ? { strengths: ['Fast to form a rule'], weaknesses: ['Tested only cases my rule accepts, so a too-narrow rule survived'], strategy: 'Test triples my current rule predicts will be rejected before trusting it.' }
          : { strengths: mem.selfModel.strengths.length ? mem.selfModel.strengths : ['Rule fit the hardest items'], weaknesses: mem.selfModel.weaknesses, strategy: mem.selfModel.strategy || 'Keep the current approach.' },
        lesson: missed ? 'Confirming tests cannot expose a rule that is too narrow. Test predicted rejections.' : 'none',
        stated_vs_actual: !mem.selfModel.strategy ? 'no prior self-model' : (said && s.falsifyCount === 0 ? 'I said I would test predicted rejections but did not.' : 'No conflict found between plan and behavior.'),
        partner_model: ctx.hasPartner ? (id === 'A' ? 'Partner picks any fitting rule, not the simplest.' : 'Partner picks the narrowest fitting rule.') : undefined,
        next_test: 'Run the same strategy on a rule from a different family.',
      });
    },
  };
}
