// Experiment runner. Emits an append-only event log. The UI renders ONLY from this log,
// so every visual corresponds to a recorded state change, and any run can be replayed.
import { createTask, publicTask, isValidTriple, scoreLabels } from '../env/ruleTask.js';
import { makeRng } from '../lib/rng.js';
import { emptyMemory, recordStats, applyReflection, diffMemory } from '../memory/store.js';
import { runChecks } from '../eval/checks.js';
import { computeAffect } from './affect.js';

export const CONDITIONS = {
  'dyad-reflect':   { label: 'Two agents, memory, reflection', agents: ['A', 'B'], memory: true,  reflect: true },
  'dyad-noreflect': { label: 'Two agents, memory of scores only, no reflection', agents: ['A', 'B'], memory: true, reflect: false },
  'dyad-nomemory':  { label: 'Two agents, reflection, memory wiped between episodes', agents: ['A', 'B'], memory: false, reflect: true },
  'single-reflect': { label: 'One agent, memory, reflection (same number of tests)', agents: ['A'], memory: true, reflect: true },
};

const key = t => t.join(',');
const str = (x, n = 600) => (x == null ? '' : String(x)).slice(0, n);
const clamp01 = x => { const n = Number(x); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null; };
const toLabel = x => { const s = String(x || '').toLowerCase(); return s.startsWith('acc') ? 'accept' : s.startsWith('rej') ? 'reject' : null; };
const list = (x, n = 3) => (Array.isArray(x) ? x.slice(0, n).map(v => str(v, 200)).filter(Boolean) : []);
const KINDS = ['metaphor', 'hypothesis', 'behavioral', 'experiential'];

function normProbe(o, seen) {
  o = o || {};
  let probe = Array.isArray(o.probe) ? o.probe.map(Number) : null, probeIssue = null;
  if (!probe) probeIssue = 'missing';
  else if (!isValidTriple(probe)) { probeIssue = 'invalid'; probe = null; }
  else if (seen.has(key(probe))) probeIssue = 'duplicate';
  return {
    message: str(o.message), hypothesis: str(o.hypothesis, 300), confidence: clamp01(o.confidence),
    probe, prediction: toLabel(o.prediction), probeReason: str(o.probe_reason, 200),
    challenge: o.challenge ? str(o.challenge, 300) : null,
    claims: Array.isArray(o.claims) ? o.claims.slice(0, 4).map(c => ({ text: str(c?.text, 300), kind: KINDS.includes(c?.kind) ? c.kind : 'hypothesis' })).filter(c => c.text) : [],
    probeIssue, mockRule: o.mockRule ?? null,
  };
}
const normSynth = o => ({
  final_hypothesis: str(o?.final_hypothesis, 300), confidence: clamp01(o?.confidence),
  established: str(o?.established, 400), agree_with_partner: typeof o?.agree_with_partner === 'boolean' ? o.agree_with_partner : null,
  unresolved: str(o?.unresolved, 400), mockRule: o?.mockRule ?? null,
});
const normDecision = (o, n) => ({ labels: Array.from({ length: n }, (_, i) => toLabel(o?.labels?.[i])), reason: str(o?.reason, 300) });
const normReflection = o => ({
  self_model: { strengths: list(o?.self_model?.strengths), weaknesses: list(o?.self_model?.weaknesses), strategy: str(o?.self_model?.strategy, 300) },
  lesson: str(o?.lesson, 300), stated_vs_actual: str(o?.stated_vs_actual, 400),
  partner_model: str(o?.partner_model, 300), next_test: str(o?.next_test, 300),
});

function statsText(s) {
  return [
    'Behavior record for the episode that just ended (measured by the experiment, not self-reported):',
    `- You ran ${s.probeCount} tests. ${s.falsifyCount} of them were tests you predicted would be REJECTED.`,
    `- Your predictions were right on ${s.predCorrect} of ${s.predTotal} tests.`,
    `- Final stated confidence: ${s.confidence ?? 'none'}. You classified ${s.correct}/${s.total} new triples correctly; on the hardest items ${s.discCorrect}/${s.discTotal}.`,
    `- The hidden rule was: "${s.targetText}". The starting examples also fit a narrower rule: "${s.decoyText}". The hardest items fit the hidden rule but not the narrower one.`,
  ].join('\n');
}

export async function runExperiment(config, deps) {
  const cfg = { rounds: 4, episodes: 2, mode: 'mock', ...config };
  const cond = CONDITIONS[cfg.condition];
  if (!cond) throw new Error(`Unknown condition: ${cfg.condition}`);
  const { makeAgent, onEvent = () => {}, gate = async () => {}, takeInjections = () => [], shouldStop = () => false } = deps;

  const events = [];
  const emit = (type, data = {}) => { const ev = { i: events.length, at: Date.now(), type, ...data }; events.push(ev); onEvent(ev, events); return ev; };
  const agents = cond.agents.map(id => makeAgent(id));
  const dyad = agents.length > 1;
  const partnerOf = id => (dyad ? agents.find(a => a.id !== id).id : null);
  const order = makeRng(cfg.seed).shuffle([0, 1, 2, 3]);
  const memory = Object.fromEntries(agents.map(a => [a.id, emptyMemory()]));
  const metricsByEp = [];

  emit('run_start', {
    config: cfg, condition: { id: cfg.condition, ...cond },
    agents: agents.map(a => ({ id: a.id, label: a.persona.label, stance: a.persona.stance, kind: a.kind })),
  });

  try {
    for (let ep = 0; ep < cfg.episodes; ep++) {
      const task = createTask(order[ep % 4], cfg.seed * 1000 + ep * 17 + 1);
      if (ep > 0 && !cond.memory) for (const a of agents) {
        emit('memory_reset', { ep, agent: a.id, before: memory[a.id] });
        memory[a.id] = emptyMemory();
      }
      const epStart = events.length;
      emit('episode_start', { ep, task: publicTask(task) });

      const obs = [], notes = [], last = {}, turns = Object.fromEntries(agents.map(a => [a.id, []]));
      const seen = () => new Set([...task.seeds, ...obs.map(o => o.triple)].map(key));
      const inject = inj => {
        if (inj.kind === 'counterexample') {
          const t = task.extra();
          const o = { triple: t, accepted: task.oracle(t), by: 'experimenter', predicted: null, surprise: false, injected: true };
          obs.push(o);
          emit('injection', { ep, kind: 'counterexample', observation: o, note: 'True result from the hidden rule. Fits the hidden rule but not the narrower decoy.' });
        } else if (inj.kind === 'note' && inj.text) {
          notes.push(str(inj.text, 300));
          emit('injection', { ep, kind: 'note', text: str(inj.text, 300) });
        }
      };

      // 1-5. Encounter, retrieve, predict, question, test
      const rounds = dyad ? cfg.rounds : cfg.rounds * 2;
      for (let r = 0; r < rounds; r++) {
        await gate({ ep, round: r });
        if (shouldStop()) { emit('run_end', { status: 'stopped' }); return events; }
        for (const inj of takeInjections()) inject(inj);
        for (const a of agents) {
          const pid = partnerOf(a.id);
          const ctx = {
            seeds: task.seeds, observations: obs.slice(), notes: notes.slice(), memory: memory[a.id],
            partner: r === 0 || !pid ? null : (last[pid] || null), hasPartner: dyad, round: r, rounds,
          };
          const res = await a.probe(ctx);
          const turn = normProbe(res.obj, seen());
          emit('turn', { ep, round: r, agent: a.id, turn, parseError: !res.obj, raw: res.raw, prompt: res.prompt });
          if (turn.probe && turn.probeIssue !== 'duplicate') {
            const accepted = task.oracle(turn.probe);
            const o = { triple: turn.probe, accepted, by: a.id, predicted: turn.prediction, surprise: turn.prediction ? (turn.prediction === 'accept') !== accepted : false, injected: false };
            obs.push(o);
            emit('observation', { ep, round: r, agent: a.id, observation: o });
          }
          last[a.id] = { ...turn, agent: a.id };
          turns[a.id].push(turn);
          emit('affect', { ep, round: r, agent: a.id, affect: computeAffect(a.id, obs, turn, pid ? last[pid] : null) });
        }
      }

      // 6. Candidate synthesis
      const synth = {};
      for (const a of agents) {
        const pid = partnerOf(a.id);
        const res = await a.synthesize({ seeds: task.seeds, observations: obs.slice(), notes, memory: memory[a.id], hasPartner: dyad, partnerSynthesis: pid ? synth[pid] || null : null });
        synth[a.id] = normSynth(res.obj);
        emit('synthesis', { ep, agent: a.id, synthesis: synth[a.id], parseError: !res.obj, raw: res.raw, prompt: res.prompt });
      }

      // 7. Test against new cases: individual decisions, scored by code
      const scores = {};
      for (const a of agents) {
        const res = await a.decide({ seeds: task.seeds, observations: obs.slice(), notes, memory: memory[a.id], testTriples: publicTask(task).testTriples });
        const d = normDecision(res.obj, task.test.length);
        scores[a.id] = scoreLabels(task, d.labels);
        emit('decision', { ep, agent: a.id, decision: d, score: scores[a.id], parseError: !res.obj, raw: res.raw, prompt: res.prompt });
      }
      emit('reveal', { ep, target: task.target, targetText: task.targetText, decoy: task.decoy, decoyText: task.decoyText, test: task.test });

      // Metrics
      const metrics = {};
      for (const a of agents) {
        const own = obs.filter(o => o.by === a.id);
        const pred = own.filter(o => o.predicted);
        const s = scores[a.id], sy = synth[a.id];
        metrics[a.id] = {
          probeCount: own.length,
          falsifyCount: own.filter(o => o.predicted === 'reject').length,
          falsifyRate: own.length ? own.filter(o => o.predicted === 'reject').length / own.length : 0,
          predAcc: pred.length ? pred.filter(o => !o.surprise).length / pred.length : null,
          predCorrect: pred.filter(o => !o.surprise).length, predTotal: pred.length,
          testAcc: s.testAcc, discAcc: s.discAcc, correct: s.correct, total: s.total, discCorrect: s.discCorrect, discTotal: s.discTotal,
          confidence: sy.confidence,
          calibrationGap: sy.confidence != null ? Math.round((sy.confidence - s.testAcc) * 100) / 100 : null,
          claimedNothingNew: /nothing new/i.test(sy.established || ''),
        };
        emit('metrics', { ep, agent: a.id, metrics: metrics[a.id] });
      }
      metricsByEp.push(metrics);

      // Evaluator (runs before reflection, so it sees the memory the agents acted on)
      const flags = runChecks({ ep, epEvents: events.slice(epStart), metrics, prevMetrics: metricsByEp[ep - 1], prevMemory: memory, dyad });
      emit('eval', { ep, flags });

      // 8-9. Update or retain, and record what changed
      for (const a of agents) {
        const m = metrics[a.id];
        const stats = { ep, ...m, targetText: task.targetText, decoyText: task.decoyText };
        const before = memory[a.id];
        if (cond.reflect) {
          const res = await a.reflect({ memory: before, stats, statsText: statsText(stats), hasPartner: dyad });
          const reflection = normReflection(res.obj);
          const after = applyReflection(before, reflection, stats);
          memory[a.id] = after;
          emit('reflection', { ep, agent: a.id, reflection, before, after, diff: diffMemory(before, after), parseError: !res.obj, raw: res.raw, prompt: res.prompt });
        } else {
          const after = recordStats(before, stats);
          memory[a.id] = after;
          emit('memory_write', { ep, agent: a.id, before, after, diff: diffMemory(before, after), note: 'Scores stored. No reflection step in this condition.' });
        }
      }
      emit('episode_end', { ep });
    }

    const first = metricsByEp[0], lastM = metricsByEp[metricsByEp.length - 1];
    const summary = Object.fromEntries(agents.map(a => [a.id, {
      discAcc: [first[a.id].discAcc, lastM[a.id].discAcc],
      falsifyRate: [first[a.id].falsifyRate, lastM[a.id].falsifyRate],
      testAcc: [first[a.id].testAcc, lastM[a.id].testAcc],
    }]));
    emit('run_end', { status: 'complete', summary });
  } catch (err) {
    emit('run_error', { message: err.message });
  }
  return events;
}
