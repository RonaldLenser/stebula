// A deterministic test double for the lesson experiment. It is NOT a model and its behavior is scripted:
// it reads ONLY the prompt text it is given (seeds, the probe result, the stored lesson), never the task
// object or the answer. It exists to prove the plumbing: that a stored lesson reaches the prompt, changes the
// scripted decision, and is scored against ground truth. A result from it says nothing about any real model.
import { makeMockAgent } from '../agents/mock.js';
import { PERSONAS } from '../agents/prompts.js';

const triples = text => [...text.matchAll(/\[(\d+), (\d+), (\d+)\]/g)].map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);

export function makeLessonDouble({ seed = 1, log = null } = {}) {
  return async function double({ system, user, messages, stage, meta }) {
    const text = user ?? messages?.map(m => m.content).join('\n') ?? '';
    log?.push({ stage, system, text });
    if (meta) Object.assign(meta, { model: 'scripted-double', stop_reason: 'end_turn', usage: { input_tokens: Math.ceil((system.length + text.length) / 4), output_tokens: 40 } });
    const seeds = triples(text.match(/known to be ACCEPTED: ([^\n]+)\./)?.[1] || '');
    // The lesson counts only if it was actually delivered in the system prompt.
    const lessonBlock = system.split('Lessons you have written down:')[1] || '';
    const lessons = lessonBlock ? [lessonBlock.split('\n').slice(1, 3).join(' ')] : [];
    const agent = makeMockAgent({ id: 'A', persona: PERSONAS.A, seed });
    const memory = { selfModel: { strategy: '' }, lessons };
    if (stage?.startsWith('lesson-probe')) {
      const r = (await agent.probe({ seeds, observations: [], memory, partner: null, hasPartner: false, round: 0, rounds: 1 })).obj;
      return JSON.stringify({ probe: r.probe, prediction: r.prediction, confidence: r.confidence, reason: r.probe_reason });
    }
    if (stage?.startsWith('lesson-decide')) {
      const tested = text.match(/You tested \[(\d+), (\d+), (\d+)\] and it was (ACCEPTED|REJECTED)/);
      const observations = tested ? [{ triple: [Number(tested[1]), Number(tested[2]), Number(tested[3])], accepted: tested[4] === 'ACCEPTED', by: 'A' }] : [];
      const list = triples(text.split('Classify each')[1] || '');
      const r = (await agent.decide({ seeds, observations, memory, notes: [], testTriples: list })).obj;
      return JSON.stringify({ labels: r.labels, confidence: 0.7, reason: r.reason });
    }
    return '{}';
  };
}
