// Output contracts for every Talk stage: a JSON Schema sent to the provider (structured output) and a code
// validator that is the real gate. The schema subset follows the provider docs (no min/max, additionalProperties false);
// ranges and uniqueness are checked here, in code.
import { MODULES } from './workspace.js';

const S = { type: 'string' }, N = { type: 'number' }, B = { type: 'boolean' };
const arrOf = items => ({ type: 'array', items });
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const orNull = schema => ({ anyOf: [schema, { type: 'null' }] });
const STANCE_ENUM = { type: 'string', enum: ['agree', 'disagree', 'unsure'] };
const UPDATE = obj({ kind: { type: 'string', enum: ['trait', 'motive', 'belief'] }, name: S, direction: { type: 'string', enum: ['supports', 'contradicts'] }, evidence_quote: S });
const SELF_MODEL = obj({ beliefs: arrOf(S), uncertainties: arrOf(S), openQuestions: arrOf(S) });

export const SCHEMAS = {
  think: obj({ thoughts: arrOf(obj({ module: { type: 'string', enum: MODULES }, text: S, relevance: N })) }),
  speak: obj({
    reply: S, self_model: orNull(SELF_MODEL), person_model: orNull(S), change_note: S,
    claims: arrOf(obj({ text: S, kind: { type: 'string', enum: ['metaphor', 'hypothesis', 'behavioral', 'experiential'] } })),
    candidate_updates: arrOf(UPDATE),
  }),
  reflect: obj({ self_model: SELF_MODEL, changed_mind: S, why: S, opening_message: S }),
  predict: obj({ predicted: STANCE_ENUM, confidence: N, reason: S }),
  answer: obj({ stance: STANCE_ENUM, reason: S }),
  baseline: obj({ answers: arrOf(S), updates: arrOf(UPDATE) }),
  digest: obj({ noticed: S, connects: arrOf(S), question: S, updates: arrOf(UPDATE) }),
  audit: obj({ findings: arrOf(obj({ type: S, quote: S, explanation: S, severity: S })), summary: S }),
  probe: obj({ probe: arrOf({ type: 'integer' }), prediction: { type: 'string', enum: ['accept', 'reject'] }, confidence: N, reason: S }),
  decide: obj({ labels: arrOf({ type: 'string', enum: ['accept', 'reject'] }), confidence: N, reason: S }),
};

const nonEmpty = (x, max = 4000) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const inRange = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;

// Each validator returns null when the output is usable, or a short reason when it is not.
export const VALIDATORS = {
  // Five-role protocol: five unique recognized roles, valid text, finite relevance in [0, 1].
  think(o) {
    const t = o?.thoughts;
    if (!Array.isArray(t)) return 'thoughts is not a list';
    if (t.length !== MODULES.length) return `expected ${MODULES.length} thoughts, got ${t.length}`;
    const seen = new Set();
    for (const x of t) {
      if (!MODULES.includes(x?.module)) return `unrecognized role "${x?.module}"`;
      if (seen.has(x.module)) return `duplicate role ${x.module}`;
      seen.add(x.module);
      if (!nonEmpty(x.text, 600)) return `empty or oversized text for ${x.module}`;
      if (!inRange(x.relevance)) return `relevance for ${x.module} is not a number from 0 to 1`;
    }
    return null;
  },
  speak: o => (nonEmpty(o?.reply, 6000) ? null : 'reply is missing or empty'),
  reflect: o => (nonEmpty(o?.opening_message, 3000) || nonEmpty(o?.changed_mind, 1000) ? (o?.self_model && typeof o.self_model === 'object' ? null : 'self_model is missing') : 'no usable reflection text'),
  predict: o => (['agree', 'disagree', 'unsure'].includes(String(o?.predicted || '').toLowerCase().split(/\W/)[0]) ? (o?.confidence === undefined || inRange(Number(o.confidence)) ? null : 'confidence out of range') : 'predicted is not agree, disagree or unsure'),
  answer: o => (['agree', 'disagree', 'unsure'].includes(String(o?.stance || '').toLowerCase().split(/\W/)[0]) ? null : 'stance is not agree, disagree or unsure'),
  baseline: o => (Array.isArray(o?.answers) && o.answers.length === 5 && o.answers.every(a => nonEmpty(a, 1500)) ? null : 'expected five non-empty answers'),
  digest: o => (nonEmpty(o?.noticed, 2000) ? null : 'noticed is missing or empty'),
  audit: o => (Array.isArray(o?.findings) && typeof o?.summary === 'string' ? null : 'findings or summary missing'),
  probe: o => (Array.isArray(o?.probe) && o.probe.length === 3 && o.probe.every(Number.isInteger) ? (['accept', 'reject'].includes(o?.prediction) ? (inRange(Number(o?.confidence)) ? null : 'confidence not in 0..1') : 'prediction is not accept or reject') : 'probe is not three integers'),
  decide: (o, n = 8) => (Array.isArray(o?.labels) && o.labels.length === n && o.labels.every(l => l === 'accept' || l === 'reject') ? (inRange(Number(o?.confidence)) ? null : 'confidence not in 0..1') : `expected ${n} accept/reject labels`),
};
