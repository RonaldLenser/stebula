// Digest mode: the agent reads a text passage by passage. Each passage runs through the same stages as a
// Talk turn (heard, affect, thoughts, workspace, speaking), then becomes an episodic memory and may add
// evidence to the personality model. Code validates every proposed quote and sets every strength.
import { thinkSystem, digestSystem, THINK_TAIL, plainSystem, baselinePrompt, foldEpisodesPrompt, BASELINE_QUESTIONS } from './prompts.js';
import { updateAffect, compete } from './workspace.js';
import { freshTalkMemory } from './session.js';
import { ingestUpdates, freshPersonality, buildItems, changeRows } from './personality.js';
import { buildContext, contextRecord } from './context.js';
import { SCHEMAS, VALIDATORS } from './schemas.js';
import { runStage, requireStage, stageSummary, throwIfAborted } from '../lib/stage.js';

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
export async function foldEpisodes(mem, llm, record = () => {}, opts = {}) {
  const plain = mem.episodes.filter(e => e.kind !== 'summary');
  if (mem.episodes.length <= EPISODE_LIMIT || plain.length < FOLD_COUNT) return false;
  const old = plain.slice(0, FOLD_COUNT);
  const r = await runStage(llm, { stage: 'fold', system: 'You write concise, accurate summaries.', user: foldEpisodesPrompt(old), max_tokens: 400, retries: 0, text: true, signal: opts.signal });
  const summary = r.ok ? str(r.value, 900) : '';
  if (!summary) return false; // keep every episode; the fold is retried after the next passage
  const ids = new Set(old.map(e => e.id));
  const n = mem.episodes.filter(e => e.kind === 'summary').length + 1;
  const folded = { id: `s${n}`, kind: 'summary', covers: old.flatMap(e => e.covers || [e.id]), source: 'several', passage: 0, summary, at: new Date().toISOString() };
  mem.episodes = [folded, ...mem.episodes.filter(e => !ids.has(e.id))];
  record('memory_change', { kind: 'fold_episodes', summaryId: folded.id, covers: folded.covers, summary });
  return true;
}

// opts: { signal, memory: 'on'|'off', traits }. A failed READ stage fails the passage and stores nothing, so a
// failed mechanism is never counted as a read passage. A failed THINK stage stores the memory but marks it degraded.
export async function digestPassage(store, llm, agent, meta, text, n, total, emit = () => {}, record = () => {}, opts = {}) {
  const { signal } = opts, memoryMode = opts.memory === 'off' ? 'off' : 'on';
  return store.locked(agent, async () => {
    throwIfAborted(signal);
    const mem = await store.load(agent);
    emit('passage', { n, total, title: meta.title });
    emit('heard', { turn: null, text });
    const prior = mem.episodes.map(e => e.summary).slice(-10);
    const { affect, causes } = updateAffect(mem.affect, text, prior, false);
    const affectBefore = mem.affect; mem.affect = affect;
    emit('affect', { before: affectBefore, after: affect, causes });

    const degraded = [], stages = [];
    const thinkCtx = buildContext(mem, { mode: memoryMode, query: text, purpose: 'digest-think', traits: opts.traits });
    const think = await runStage(llm, {
      stage: 'digest-think', system: thinkSystem(mem, affect, thinkCtx),
      messages: [{ role: 'user', content: `The person is reading you passage ${n} of ${total} from "${meta.title}":\n\n${text}${THINK_TAIL}` }],
      max_tokens: 900, schema: SCHEMAS.think, validate: VALIDATORS.think, retries: 1, signal, context: contextRecord(thinkCtx),
    });
    stages.push({ ...stageSummary('think', think), context: contextRecord(thinkCtx) });
    if (!think.ok) degraded.push({ stage: 'think', ...think.failure });
    const candidates = compete(think.ok ? think.value.thoughts : [], affect, mem.lastWorkspace.map(t => t.text));
    const workspace = candidates.filter(t => t.won);
    emit('thoughts', { candidates, status: think.ok ? 'ok' : 'failed', failure: think.failure || null, attempts: think.attempts.length });
    emit('workspace', { winners: workspace.map(({ module, text, score }) => ({ module, text, score })), status: think.ok ? 'ok' : 'failed' });

    const readCtx = buildContext(mem, { mode: memoryMode, query: text, purpose: 'digest-read', traits: opts.traits });
    const read = await requireStage(llm, {
      stage: 'digest-read', system: digestSystem(mem, meta.title, workspace, readCtx),
      messages: [{ role: 'user', content: `Passage ${n} of ${total}:\n\n${text}\n\n(Respond with the JSON object described in your instructions.)` }],
      max_tokens: 1200, schema: SCHEMAS.digest, validate: VALIDATORS.digest, retries: 1, signal, context: contextRecord(readCtx),
    });
    stages.push({ ...stageSummary('digest-read', read), context: contextRecord(readCtx) });
    const obj = read.value;
    const ids = new Set(mem.episodes.flatMap(e => [e.id, ...(e.covers || [])]));
    mem.episodeSeq = (mem.episodeSeq || mem.episodes.length) + 1;
    const episode = {
      id: `m${mem.episodeSeq}`, kind: 'passage', source: meta.title, sourceNote: str(meta.source, 200), passage: n,
      summary: str(obj.noticed, 500), question: str(obj.question, 300),
      connects: Array.isArray(obj.connects) ? obj.connects.map(String).filter(id => ids.has(id)).slice(0, 5) : [],
      excerpt: text.slice(0, 160), at: new Date().toISOString(), parseError: false, status: degraded.length ? 'degraded' : 'ok', degraded,
    };
    emit('speaking', { reply: episode.summary, status: episode.status });
    // Degraded passages are kept as memory but excluded from analysis: they add no personality evidence.
    const ing = degraded.length ? { event: null, entries: [], rejected: [] } : ingestUpdates(mem, { source: meta.title, sourceType: 'digest', ref: episode.id }, obj.updates, text);
    episode.eventId = ing.event?.id ?? null;
    mem.episodes.push(episode);
    mem.lastWorkspace = think.ok ? workspace.map(({ module, text }) => ({ module, text })) : [];
    mem.lastActivity = episode.at;
    emit('personality', { entries: ing.entries, rejected: ing.rejected, items: buildItems(mem.personality).length });
    record('digest', { title: meta.title, source: meta.source ?? '', passage: n, total, text, episode, affectBefore, affect, causes, candidates, rejected: ing.rejected, status: episode.status, degraded, excludeFromAnalysis: degraded.length > 0, stages, memoryMode });
    if (ing.event) record('personality_change', { origin: 'digest', event: ing.event.id, source: meta.title, rows: changeRows(mem.personality, ing.entries), rejected: ing.rejected });
    await foldEpisodes(mem, llm, record, { signal });
    await store.save(mem);
    emit('digested', { episode, rejected: ing.rejected.length });
    return { episode, candidates: candidates.length, entries: ing.entries };
  });
}

// `startAt` (1-based) resumes after a failure without re-reading earlier passages.
export async function digestText(store, llm, agent, { title, source, text, startAt }, emit = () => {}, record = () => {}, opts = {}) {
  const passages = splitPassages(String(text || '').slice(0, MAX_CHARS));
  if (!passages.length) throw new Error('Nothing to read. Paste text, speak, or upload a .txt file.');
  const meta = { title: str(title, 120).trim() || 'Untitled', source };
  for (let i = Math.max(1, Number(startAt) || 1) - 1; i < passages.length; i++) {
    try { await digestPassage(store, llm, agent, meta, passages[i], i + 1, passages.length, emit, record, opts); }
    catch (e) { e.passage = i + 1; e.passages = passages.length; throw e; }
  }
  emit('done', { passages: passages.length });
  return { passages: passages.length };
}

// A fresh copy with empty memory answers the same five questions. Traits that show up here come from the
// base model, not from anything it read.
// With `opts.keepMemory` the agent answers with its current memory instead of an empty one (experiment checkpoints).
// Checkpoints supply reading memories by recency, bounded, so the answers can reflect what was read.
export async function runBaseline(store, llm, agent, record = () => {}, opts = {}) {
  const { signal } = opts, memoryMode = opts.memory === 'off' ? 'off' : 'on';
  return store.locked(agent, async () => {
    const mem = await store.load(agent);
    const fresh = opts.keepMemory ? { ...mem, personality: freshPersonality() } : freshTalkMemory(agent);
    const ctx = buildContext(fresh, { mode: opts.keepMemory ? memoryMode : 'on', select: 'recent', purpose: opts.keepMemory ? 'checkpoint-questions' : 'baseline-questions', traits: opts.traits });
    const r = await requireStage(llm, { stage: 'personality-questions', system: plainSystem(fresh, ctx), user: baselinePrompt(), max_tokens: 1200, schema: SCHEMAS.baseline, validate: VALIDATORS.baseline, retries: 1, signal, context: contextRecord(ctx) });
    const obj = r.value;
    const answers = BASELINE_QUESTIONS.map((q, i) => ({ q, a: str(obj.answers[i], 600) }));
    fresh.personality = freshPersonality();
    const ing = ingestUpdates(fresh, { source: 'baseline', sourceType: 'baseline', ref: null }, obj.updates, answers.map(x => x.a).join('\n'));
    const result = { at: new Date().toISOString(), answers, personality: fresh.personality, rejected: ing.rejected.length, parseError: false, raw: r.raw, context: contextRecord(ctx) };
    record('personality_questions', { keepMemory: Boolean(opts.keepMemory), memoryMode, answers, rejected: result.rejected, parseError: false, context: contextRecord(ctx), traits: buildItems(fresh.personality).map(i => ({ name: i.name, kind: i.kind, strength: i.strength })) });
    if (opts.keepMemory) return { baseline: result, items: buildItems(fresh.personality) };
    mem.baseline = result;
    await store.save(mem);
    return { baseline: mem.baseline };
  });
}
