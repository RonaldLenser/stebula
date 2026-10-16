// Digest mode: the agent reads a text passage by passage. Each passage runs through the same stages as a
// Talk turn (heard, affect, thoughts, workspace, speaking), then becomes an episodic memory and may add
// evidence to the personality model. Code validates every proposed quote and sets every strength.
import { extractJson } from '../agents/parse.js';
import { thinkSystem, digestSystem, THINK_TAIL, plainSystem, baselinePrompt, foldEpisodesPrompt, BASELINE_QUESTIONS } from './prompts.js';
import { updateAffect, compete } from './workspace.js';
import { freshTalkMemory } from './session.js';
import { ingestUpdates, freshPersonality, buildItems } from './personality.js';

export const PASSAGE_WORDS = 200, EPISODE_LIMIT = 60, FOLD_COUNT = 30, MAX_CHARS = 120_000;
const str = (x, n = 600) => (x == null ? '' : String(x)).slice(0, n);

// Split into passages of about PASSAGE_WORDS words, breaking at sentence ends.
export function splitPassages(text, target = PASSAGE_WORDS) {
  const sentences = String(text || '').replace(/\r/g, '').split(/(?<=[.!?])\s+|\n{2,}/).map(s => s.trim()).filter(Boolean);
  const out = []; let cur = [], count = 0;
  const flush = () => { if (cur.length) out.push(cur.join(' ')); cur = []; count = 0; };
  for (const s of sentences) {
    const w = s.split(/\s+/);
    if (w.length > target * 1.5) { flush(); for (let i = 0; i < w.length; i += target) out.push(w.slice(i, i + target).join(' ')); continue; }
    cur.push(s); count += w.length;
    if (count >= target) flush();
  }
  flush();
  return out;
}

// Fold the oldest episodes into one summary memory. Ids stay listed in `covers` and events keep their
// own records, so every provenance link still resolves.
export async function foldEpisodes(mem, llm) {
  const plain = mem.episodes.filter(e => e.kind !== 'summary');
  if (mem.episodes.length <= EPISODE_LIMIT || plain.length < FOLD_COUNT) return false;
  const old = plain.slice(0, FOLD_COUNT);
  let summary;
  try { summary = str(await llm({ system: 'You write concise, accurate summaries.', user: foldEpisodesPrompt(old), max_tokens: 400 }), 900); } catch { return false; }
  if (!summary) return false;
  const ids = new Set(old.map(e => e.id));
  const n = mem.episodes.filter(e => e.kind === 'summary').length + 1;
  const folded = { id: `s${n}`, kind: 'summary', covers: old.flatMap(e => e.covers || [e.id]), source: 'several', passage: 0, summary, at: new Date().toISOString() };
  mem.episodes = [folded, ...mem.episodes.filter(e => !ids.has(e.id))];
  return true;
}

export async function digestPassage(store, llm, agent, meta, text, n, total, emit = () => {}) {
  return store.locked(agent, async () => {
    const mem = await store.load(agent);
    emit('passage', { n, total, title: meta.title });
    emit('heard', { turn: null, text });
    const prior = mem.episodes.map(e => e.summary).slice(-10);
    const { affect, causes } = updateAffect(mem.affect, text, prior, false);
    const affectBefore = mem.affect; mem.affect = affect;
    emit('affect', { before: affectBefore, after: affect, causes });

    const thinkRaw = await llm({ system: thinkSystem(mem, affect), messages: [{ role: 'user', content: `The person is reading you passage ${n} of ${total} from "${meta.title}":\n\n${text}${THINK_TAIL}` }], max_tokens: 900 });
    const thoughts = extractJson(thinkRaw)?.thoughts;
    const candidates = compete(Array.isArray(thoughts) ? thoughts : [], affect, mem.lastWorkspace.map(t => t.text));
    const workspace = candidates.filter(t => t.won);
    emit('thoughts', { candidates });
    emit('workspace', { winners: workspace.map(({ module, text, score }) => ({ module, text, score })) });

    const raw = await llm({ system: digestSystem(mem, meta.title, workspace), messages: [{ role: 'user', content: `Passage ${n} of ${total}:\n\n${text}\n\n(Respond with the JSON object described in your instructions.)` }], max_tokens: 1200 });
    const obj = extractJson(raw);
    const ids = new Set(mem.episodes.flatMap(e => [e.id, ...(e.covers || [])]));
    mem.episodeSeq = (mem.episodeSeq || mem.episodes.length) + 1;
    const episode = {
      id: `m${mem.episodeSeq}`, kind: 'passage', source: meta.title, sourceNote: str(meta.source, 200), passage: n,
      summary: str(obj?.noticed, 500) || '(the model returned nothing readable for this passage)', question: str(obj?.question, 300),
      connects: Array.isArray(obj?.connects) ? obj.connects.map(String).filter(id => ids.has(id)).slice(0, 5) : [],
      excerpt: text.slice(0, 160), at: new Date().toISOString(), parseError: !obj?.noticed,
    };
    emit('speaking', { reply: episode.summary });
    const ing = ingestUpdates(mem, { source: meta.title, sourceType: 'digest', ref: episode.id }, obj?.updates, text);
    episode.eventId = ing.event?.id ?? null;
    mem.episodes.push(episode);
    mem.lastWorkspace = workspace.map(({ module, text }) => ({ module, text }));
    mem.lastActivity = episode.at;
    emit('personality', { entries: ing.entries, rejected: ing.rejected, items: buildItems(mem.personality).length });
    await foldEpisodes(mem, llm);
    await store.save(mem);
    emit('digested', { episode, rejected: ing.rejected.length });
    return { episode, candidates: candidates.length, entries: ing.entries };
  });
}

export async function digestText(store, llm, agent, { title, source, text }, emit = () => {}) {
  const passages = splitPassages(String(text || '').slice(0, MAX_CHARS));
  if (!passages.length) throw new Error('Nothing to read. Paste text, speak, or upload a .txt file.');
  const meta = { title: str(title, 120).trim() || 'Untitled', source };
  for (let i = 0; i < passages.length; i++) await digestPassage(store, llm, agent, meta, passages[i], i + 1, passages.length, emit);
  emit('done', { passages: passages.length });
  return { passages: passages.length };
}

// A fresh copy with empty memory answers the same five questions. Traits that show up here come from the
// base model, not from anything it read.
export async function runBaseline(store, llm, agent) {
  return store.locked(agent, async () => {
    const mem = await store.load(agent);
    const fresh = freshTalkMemory(agent);
    const raw = await llm({ system: plainSystem(fresh), user: baselinePrompt(), max_tokens: 1200 });
    const obj = extractJson(raw) || {};
    const answers = BASELINE_QUESTIONS.map((q, i) => ({ q, a: str(Array.isArray(obj.answers) ? obj.answers[i] : '', 600) }));
    fresh.personality = freshPersonality();
    const ing = ingestUpdates(fresh, { source: 'baseline', sourceType: 'baseline', ref: null }, obj.updates, answers.map(x => x.a).join('\n'));
    mem.baseline = { at: new Date().toISOString(), answers, personality: fresh.personality, rejected: ing.rejected.length, parseError: !extractJson(raw), raw };
    await store.save(mem);
    return { baseline: mem.baseline };
  });
}
