// Personality model, controlled by code. The model may only PROPOSE evidence (a candidate update with a
// verbatim quote). Strength and status are computed here from an append-only log, so any past moment
// can be replayed and nothing the model says can set a strength directly.
import { jaccard } from '../eval/checks.js';

export const KINDS = ['trait', 'motive', 'belief'];
export const SUPPORT = 0.15, CONTRADICT = 0.2;
const r2 = x => Math.round(x * 100) / 100;
const clamp = x => Math.min(1, Math.max(0, x));
export const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const itemId = (kind, name) => `${kind}:${norm(name)}`;

export const freshPersonality = () => ({ events: [], log: [], nextEvent: 1 });

// An event is one thing that happened: a passage read or a conversation turn. It belongs to a source.
export function addEvent(p, { source, sourceType, ref, text }) {
  const ev = { id: `e${p.nextEvent++}`, at: new Date().toISOString(), source, sourceType, ref: ref ?? null, excerpt: String(text || '').slice(0, 200) };
  p.events.push(ev);
  return ev;
}

// Keep only well-formed updates whose quote really appears in the text the event came from.
export function validateCandidates(cands, sourceText) {
  const accepted = [], rejected = [];
  const hay = norm(sourceText);
  for (const c of Array.isArray(cands) ? cands.slice(0, 6) : []) {
    const kind = String(c?.kind || '').toLowerCase(), name = String(c?.name || '').trim().slice(0, 60);
    const dir = /^contradict/i.test(c?.direction) ? 'contradicts' : /^support/i.test(c?.direction) ? 'supports' : null;
    const quote = String(c?.evidence_quote || '').trim().slice(0, 300);
    const why = !KINDS.includes(kind) ? 'unknown kind' : !name ? 'no name' : !dir ? 'unknown direction' : !quote ? 'no quote' : !hay.includes(norm(quote)) ? 'quote not found in source text' : null;
    (why ? rejected : accepted).push(why ? { ...c, why } : { kind, name, direction: dir, quote });
  }
  return { accepted, rejected };
}

// Append accepted candidates to the log. Returns the new log entries.
export function applyCandidates(p, event, accepted) {
  const out = [];
  for (const c of accepted) {
    const entry = { n: p.log.length + 1, eventId: event.id, id: itemId(c.kind, c.name), kind: c.kind, name: c.name, direction: c.direction, quote: c.quote, source: event.source, at: event.at };
    p.log.push(entry); out.push(entry);
  }
  return out;
}

// Replay the log (first `upTo` entries) into items. The only place strength is computed.
export function buildItems(p, upTo = Infinity) {
  const items = new Map();
  for (const e of p.log.slice(0, upTo)) {
    let it = items.get(e.id);
    if (!it) {
      if (e.direction === 'contradicts') continue; // nothing to weaken yet
      it = { id: e.id, kind: e.kind, name: e.name, strength: 0, originEvent: e.eventId, evidence: [], counter: [], history: [] };
      items.set(e.id, it);
    }
    it.strength = r2(clamp(it.strength + (e.direction === 'supports' ? SUPPORT : -CONTRADICT)));
    (e.direction === 'supports' ? it.evidence : it.counter).push({ n: e.n, eventId: e.eventId, source: e.source, quote: e.quote, at: e.at });
    it.history.push({ n: e.n, strength: it.strength });
  }
  for (const it of items.values()) {
    const evs = new Set(it.evidence.map(x => x.eventId)), srcs = new Set(it.evidence.map(x => x.source));
    it.status = evs.size >= 3 && srcs.size >= 2 ? 'established' : evs.size >= 2 ? 'forming' : 'emerging';
  }
  return [...items.values()];
}

// ---- said vs shown: fixed proxies the code can compute from the conversation record ----
const CHALLENGE_OUT = /\b(i disagree|that'?s not (?:quite )?(?:right|true)|i don'?t think that|i'?m not convinced|that doesn'?t follow|unsupported|i'?d push back|are you sure)\b/i;
const HEDGE = /\b(maybe|perhaps|might|may|possibly|probably|i think|i suspect|not sure|uncertain|unclear|i don'?t know|could be|seems)\b/i;
const MEMREF = /\b(earlier|before|you said|you mentioned|last time|we talked|i remember|my memory|previously|you asked)\b/i;
export const PROXIES = {
  questions: { label: 'questions asked per turn', hint: /curious|inquisitive|question|interest|explor|wonder/ },
  challenges: { label: 'challenges to the person', hint: /skeptic|challeng|critical|rigor|disagree|direct|assertive|analytic/ },
  hedging: { label: 'hedging language', hint: /cautious|humble|tentative|hedg|uncertain|careful|modest|honest about/ },
  memory: { label: 'references to past memories', hint: /reflective|remember|continuity|memory|nostalg|thoughtful/ },
  initiative: { label: 'initiative wins in the workspace', hint: /proactive|initiative|driv|lead|direct|self-?start/ },
};
export const proxyFor = item => (item.kind === 'trait' ? Object.keys(PROXIES).find(k => PROXIES[k].hint.test(norm(item.name))) || null : null);

// Fraction of the agent's replies showing the behavior (0..1), plus how many replies were measured.
export function measureProxy(key, archive) {
  const replies = archive.filter(m => m.role === 'assistant' && m.kind !== 'opening' && m.monologue);
  const n = replies.length;
  if (!n) return { value: null, n: 0 };
  const test = {
    questions: m => /\?/.test(m.text),
    challenges: m => CHALLENGE_OUT.test(m.text),
    hedging: m => HEDGE.test(m.text),
    memory: m => MEMREF.test(m.text),
    initiative: m => m.monologue.candidates?.some(c => c.module === 'initiative' && c.won),
  }[key];
  return { value: r2(replies.filter(test).length / n), n };
}

export const MIN_TURNS_FOR_FLAG = 3, STATED_FLOOR = 0.3, SHOWN_FLOOR = 0.2;
export function saidVsShown(item, archive) {
  const key = proxyFor(item);
  if (!key) return { proxy: null, note: 'No measurable proxy in the fixed list.' };
  const m = measureProxy(key, archive);
  const flagged = m.n >= MIN_TURNS_FOR_FLAG && item.strength >= STATED_FLOOR && m.value < SHOWN_FLOOR;
  return { proxy: key, label: PROXIES[key].label, shown: m.value, n: m.n, flagged };
}

// ---- comparison helpers for the Compare view ----
export const sameName = (a, b) => a.kind === b.kind && (norm(a.name) === norm(b.name) || jaccard(norm(a.name), norm(b.name)) >= 0.5);
export function compareModels(a, b, baseline) {
  const find = (list, x) => list.find(y => sameName(x, y));
  const tag = (x, others, base) => ({ ...x, inBaseline: Boolean(find(base, x)), inOther: Boolean(find(others, x)) });
  return { a: a.map(x => tag(x, b, baseline)), b: b.map(x => tag(x, a, baseline)), baseline };
}

export const talkSource = at => `Conversation ${String(at).slice(0, 10)}`;

// One call site for both Digest and Talk: record the event, validate the proposals, append to the log.
export function ingestUpdates(mem, { source, sourceType, ref }, cands, sourceText) {
  const p = mem.personality;
  const { accepted, rejected } = validateCandidates(cands, sourceText);
  if (!accepted.length && !rejected.length) return { event: null, entries: [], rejected };
  const event = addEvent(p, { source, sourceType, ref, text: sourceText });
  return { event, entries: applyCandidates(p, event, accepted), rejected };
}
