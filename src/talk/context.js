// The one place that decides which stored memories a model call may see.
//
// Contract (shared by Talk, Digest, self-tests, checkpoints and experiments):
//  - mode "on": the agent's own memory is supplied, plus a bounded set of reading memories (episodes).
//  - mode "off": nothing stored is supplied. The memory file may still contain memories; they are NOT delivered.
//  - Reading memories are chosen by relevance to the query ("relevant") or by recency ("recent"), at most
//    `maxEpisodes` and `maxChars`. The archive is never dumped whole.
//  - Every supplied memory keeps its id and source. The returned descriptor is recorded with the model call, so
//    "the file contains a memory" and "the model received it" are separate, checkable facts.
//  - Personality traits are evaluation annotations. They stay out of prompts unless a protocol sets
//    traits: "in-prompt" on purpose, and that choice is recorded too.
export const MEMORY_MODES = ['on', 'off'];
export const DEFAULT_LIMITS = { maxEpisodes: 4, maxChars: 1600, summaryChars: 380 };
const STOP = new Set('the a an and or but if then of to in on at for with is are was were be been it its this that these those i you he she we they me my your our their as by from not no do does did have has had so than too very can will just about into over how what why when where who which'.split(' '));
export const contentWords = s => (String(s || '').toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || []).filter(w => !STOP.has(w) && w.length > 1);

// Overlap of content words, 0..1, as the share of the episode's distinctive words the query shares.
function relevance(query, ep) {
  const q = new Set(contentWords(query));
  if (!q.size) return 0;
  const words = new Set(contentWords(`${ep.summary} ${ep.question || ''} ${ep.excerpt || ''}`));
  if (!words.size) return 0;
  let shared = 0; for (const w of q) if (words.has(w)) shared++;
  return shared / Math.sqrt(q.size * words.size);
}

export function buildContext(mem, { mode = 'on', query = '', select = 'relevant', traits = 'evaluation-only', limits = {}, purpose = '' } = {}) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const eps = mem.episodes || [];
  const base = { mode, select, purpose, traits, limits: L, available: eps.length, supplied: [], omitted: eps.length, chars: 0, selfModel: false, lessons: 0, traitIds: [] };
  if (mode !== 'on') return { ...base, supplied: [], text: '', block: 'Your memory is switched off for this condition. You have no stored memory.' };
  let ranked;
  if (select === 'recent') ranked = eps.map((e, i) => ({ e, score: null, i })).sort((a, b) => b.i - a.i);
  else ranked = eps.map((e, i) => ({ e, score: relevance(query, e), i })).filter(x => x.score > 0).sort((a, b) => b.score - a.score || b.i - a.i);
  const supplied = []; let chars = 0;
  for (const { e, score } of ranked) {
    if (supplied.length >= L.maxEpisodes) break;
    const text = String(e.summary || '').slice(0, L.summaryChars);
    if (!text || chars + text.length > L.maxChars) continue;
    chars += text.length;
    supplied.push({ id: e.id, kind: e.kind || 'passage', source: e.source, passage: e.passage, covers: e.covers || null, score: score == null ? null : Math.round(score * 100) / 100, text });
  }
  const lessons = (mem.lessons || []).filter(Boolean);
  const out = { ...base, supplied, omitted: eps.length - supplied.length, chars, selfModel: true, lessons: lessons.length };
  if (traits === 'in-prompt') out.traitIds = (mem.personality?.log || []).map(l => l.id).filter((v, i, a) => a.indexOf(v) === i).slice(0, 8);
  out.text = supplied.length ? `Things you have read or been told (id, source: what you noted). Only those relevant to now are shown, ${out.omitted} others are stored but not shown:\n${supplied.map(s => `- [${s.id}] (${s.source}${s.passage ? `, passage ${s.passage}` : ''}): ${s.text}`).join('\n')}` : '';
  out.block = out.text;
  return out;
}

// What goes into the record: ids and sizes, not the whole archive.
export const contextRecord = c => c && ({ mode: c.mode, select: c.select, purpose: c.purpose, traits: c.traits, available: c.available, omitted: c.omitted, chars: c.chars, supplied: c.supplied.map(({ id, kind, source, passage, score }) => ({ id, kind, source, passage, score })), lessons: c.lessons, traitIds: c.traitIds });
