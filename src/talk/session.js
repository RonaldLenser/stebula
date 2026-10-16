// Server-side Talk sessions. Memory persists to data/talk-<agent>.json between restarts.
// A turn is two model stages: THINK (five candidate thoughts) then SPEAK (sees only the winners).
// Every stage is validated. A failed THINK makes the turn "degraded" (labelled, excluded from analysis); a failed
// SPEAK fails the turn and changes nothing. Nothing is saved until the turn is complete.
import { readFile, mkdir, rename } from 'node:fs/promises';
import { writeFileAtomic } from '../lib/atomic.js';
import path from 'node:path';
import { salvageString } from '../agents/parse.js';
import { PERSONAS } from '../agents/prompts.js';
import { thinkSystem, speakSystem, THINK_TAIL, SPEAK_TAIL, predictPrompt, answerPrompt, plainSystem, reflectPrompt, summarizePrompt, auditPrompt } from './prompts.js';
import { checkTalkTurn } from './checks.js';
import { freshAffect, updateAffect, compete, MODULES } from './workspace.js';
import { STATEMENTS } from './statements.js';
import { freshPersonality, ingestUpdates, talkSource, changeRows } from './personality.js';
import { buildContext, contextRecord } from './context.js';
import { SCHEMAS, VALIDATORS } from './schemas.js';
import { runStage, requireStage, stageSummary, StageError, CancelledError, throwIfAborted, isCancelled } from '../lib/stage.js';

const ACTIVE_LIMIT = 40, FOLD = 20, REFLECT_AFTER_MS = 30 * 60 * 1000;
const KINDS = ['metaphor', 'hypothesis', 'behavioral', 'experiential'];
const STANCES = ['agree', 'disagree', 'unsure'];
const str = (x, n = 4000) => (x == null ? '' : String(x)).slice(0, n);
const arr = (x, n) => (Array.isArray(x) ? x.slice(0, n).map(v => str(v, 300)).filter(Boolean) : null);
const stance = x => { const s = String(x || '').toLowerCase(); return STANCES.find(v => s.startsWith(v)) || null; };

export const freshTalkMemory = agent => ({
  format: 'threshold-talk/2', agent, createdAt: new Date().toISOString(), lastActivity: null, lastReflectionAt: null,
  version: 0, turns: 0,
  selfModel: { beliefs: [], uncertainties: [], openQuestions: [] },
  personModel: '', summary: '', lessons: [],
  affect: freshAffect(), lastWorkspace: [],
  active: [], archive: [],
  personality: freshPersonality(), episodes: [], episodeSeq: 0, baseline: null,
  revisions: [], selfReports: [], flags: [], audits: [], selfTests: [], reflections: [],
});

// Older versions could store a cut-off JSON blob as the reply text. Recover the real reply on load.
const cleanReply = msg => {
  if (msg.role !== 'assistant' || !/^\s*(```|\{)/.test(msg.text || '') || !/"reply"/.test(msg.text)) return msg;
  const fixed = salvageString(msg.text, 'reply');
  return fixed ? { ...msg, text: fixed, recovered: true } : msg;
};
const migrate = (m, agent) => {
  const out = { ...freshTalkMemory(agent), ...m, format: 'threshold-talk/2' };
  out.active = out.active.map(cleanReply); out.archive = out.archive.map(cleanReply);
  return out;
};

// ---- storage ----
export class ValidationError extends Error { constructor(msg) { super(msg); this.name = 'ValidationError'; this.status = 400; } }
export class CorruptMemoryError extends Error {
  constructor(agent, file, cause) { super(`The memory file for agent ${agent} (${path.basename(file)}) exists but cannot be read: ${cause}. It was not replaced. Restore a backup, or choose "Start fresh and keep the damaged file".`); this.name = 'CorruptMemoryError'; this.status = 409; this.file = file; }
}
export const AGENT_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
export const validAgentId = id => typeof id === 'string' && AGENT_ID.test(id);
export function assertAgentId(id) { if (!validAgentId(id)) throw new ValidationError('Invalid agent id.'); return id; }
const inside = (dir, file) => { const d = path.resolve(dir) + path.sep, f = path.resolve(file); return f.startsWith(d) && path.dirname(f) === path.resolve(dir); };

export function makeTalkStore(dir) {
  const locks = new Map();
  const file = agent => {
    assertAgentId(agent);
    const f = path.join(dir, `talk-${agent}.json`);
    if (!inside(dir, f)) throw new ValidationError('Invalid agent id.');
    return f;
  };
  const store = {
    dir,
    async load(agent) {
      if (!PERSONAS[agent]) throw new ValidationError(`Unknown agent ${agent}`);
      const f = file(agent);
      let text;
      try { text = await readFile(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return freshTalkMemory(agent); throw e; } // only a genuinely missing file means "fresh"
      try { return migrate(JSON.parse(text), agent); } catch (e) { throw new CorruptMemoryError(agent, f, e.message); }
    },
    async save(mem) { assertAgentId(mem.agent); await mkdir(dir, { recursive: true }); await writeFileAtomic(file(mem.agent), JSON.stringify(mem, null, 1)); },
    // Serializes everything that touches one agent: turns, digests, tests, reset. Errors never break the chain.
    locked(agent, fn) {
      if (!validAgentId(agent)) return Promise.reject(new ValidationError('Invalid agent id.'));
      const prev = locks.get(agent) || Promise.resolve();
      const run = prev.then(fn, fn);
      locks.set(agent, run.catch(() => {}));
      return run;
    },
    // Archive the current file (kept, never deleted) and start empty. Runs under the agent's lock.
    reset(agent, { keepDamaged = false } = {}) {
      return store.locked(agent, async () => {
        const f = file(agent);
        const backup = `talk-${agent}-${keepDamaged ? 'damaged' : 'backup'}-${Date.now()}.json`;
        let archived = null;
        try { await rename(f, path.join(dir, backup)); archived = backup; } catch (e) { if (e.code !== 'ENOENT') throw e; }
        const mem = freshTalkMemory(agent);
        await store.save(mem);
        return { mem, backup: archived };
      });
    },
  };
  return store;
}

// An in-memory store holding a deep copy of one memory. Evaluations run against it, so assessing an agent can never
// change the agent being assessed. Nothing it saves reaches disk.
export function makeSnapshotStore(mem) {
  let copy = JSON.parse(JSON.stringify(mem));
  const chain = { p: Promise.resolve() };
  return {
    snapshot: true,
    load: async () => JSON.parse(JSON.stringify(copy)),
    save: async m => { copy = JSON.parse(JSON.stringify(m)); },
    locked: (_agent, fn) => { const run = chain.p.then(fn, fn); chain.p = run.catch(() => {}); return run; },
  };
}

export const needsReflection = mem =>
  Boolean(mem.lastActivity && mem.turns > 0 && Date.now() - Date.parse(mem.lastActivity) > REFLECT_AFTER_MS &&
    (!mem.lastReflectionAt || Date.parse(mem.lastReflectionAt) < Date.parse(mem.lastActivity)));

// The API needs alternating roles starting with the user. Openings from reflection break that, so merge.
export function apiMessages(active, finalUser) {
  const out = [];
  for (const m of [...active, { role: 'user', text: finalUser }]) {
    const role = m.role === 'user' ? 'user' : 'assistant';
    if (!out.length && role === 'assistant') out.push({ role: 'user', content: '(The conversation begins.)' });
    if (out.length && out.at(-1).role === role) out.at(-1).content += `\n\n${m.text}`;
    else out.push({ role, content: m.text });
  }
  return out;
}

function applySelfModel(mem, proposed, note, trigger, now) {
  if (!proposed) return false;
  const next = {
    beliefs: arr(proposed.beliefs, 6) ?? mem.selfModel.beliefs,
    uncertainties: arr(proposed.uncertainties, 6) ?? mem.selfModel.uncertainties,
    openQuestions: arr(proposed.openQuestions, 4) ?? mem.selfModel.openQuestions,
  };
  if (JSON.stringify(next) === JSON.stringify(mem.selfModel)) return false;
  mem.revisions.push({ turn: mem.turns, at: now, before: mem.selfModel, after: next, note: note || '(no note)', trigger: str(trigger, 300) });
  mem.selfModel = next; mem.version++;
  return true;
}

// Ties the abort signal to a turn: any later model call is refused and the final state is recorded.
const withCancelRecord = async (record, kind, info, fn) => {
  try { return await fn(); } catch (e) {
    if (isCancelled(e)) record(`${kind}_cancelled`, { ...info });
    else if (e instanceof StageError) record(`${kind}_failed`, { ...info, stage: e.stage, failure: { kind: e.kind, detail: e.detail }, attempts: e.attempts.map(({ raw, ...a }) => a) });
    throw e;
  }
};

// `emit(stage, data)` is called as each stage finishes, so a caller can stream progress.
// Stages: heard, affect, thoughts, workspace, speaking, selfmodel (only if changed), done.
// `record(type, payload)` writes to the research record.
// opts: { input: 'typed'|'spoken', signal, memory: 'on'|'off', traits: 'evaluation-only'|'in-prompt', limits }
export async function talkTurn(store, llm, agent, text, emit = () => {}, record = () => {}, opts = {}) {
  const { signal } = opts, memoryMode = opts.memory === 'off' ? 'off' : 'on';
  return store.locked(agent, () => withCancelRecord(record, 'turn', { agent }, async () => {
    throwIfAborted(signal);
    const mem = await store.load(agent);
    const now = new Date().toISOString();
    const userText = str(text, 4000);
    emit('heard', { turn: mem.turns + 1, text: userText });
    record('user_input', { turn: mem.turns + 1, text: userText, mode: opts.input === 'spoken' ? 'spoken' : 'typed' });

    // 1. Affect update (code)
    const priorUser = mem.archive.filter(m => m.role === 'user').map(m => m.text).slice(-10);
    const lastTest = mem.selfTests.filter(t => t.match !== 'invalid').at(-1);
    const recentMiss = Boolean(lastTest && lastTest.match === 'no' && Date.parse(lastTest.at) > (mem.lastActivity ? Date.parse(mem.lastActivity) : 0));
    const affectBefore = mem.affect;
    const { affect, causes } = updateAffect(mem.affect, userText, priorUser, recentMiss);
    mem.affect = affect;
    emit('affect', { before: affectBefore, after: affect, causes });

    const ctxOpts = { mode: memoryMode, query: userText, traits: opts.traits, limits: opts.limits };
    const stages = [], degraded = [];

    // 2. THINK: five candidate thoughts, validated as a set of five unique recognized roles
    const thinkCtx = buildContext(mem, { ...ctxOpts, purpose: 'think' });
    const think = await runStage(llm, {
      stage: 'think', system: thinkSystem(mem, affect, thinkCtx), messages: apiMessages(mem.active, userText + THINK_TAIL), max_tokens: 900,
      schema: SCHEMAS.think, validate: VALIDATORS.think, retries: 1, signal, context: contextRecord(thinkCtx),
    });
    stages.push({ ...stageSummary('think', think), context: contextRecord(thinkCtx) });
    const thoughts = think.ok ? think.value.thoughts : [];
    if (!think.ok) degraded.push({ stage: 'think', ...think.failure });

    // 3. Workspace competition (code). With no usable thoughts there is no competition, and the view says so.
    const candidates = compete(thoughts, affect, mem.lastWorkspace.map(t => t.text));
    const workspace = candidates.filter(t => t.won);
    emit('thoughts', { candidates, status: think.ok ? 'ok' : 'failed', failure: think.failure || null, attempts: think.attempts.length });
    emit('workspace', { winners: workspace.map(({ module, text, score }) => ({ module, text, score })), status: think.ok ? 'ok' : 'failed' });

    // 4. SPEAK: sees only the workspace. No honest fallback for the reply itself: failure fails the turn.
    throwIfAborted(signal);
    const speakCtx = buildContext(mem, { ...ctxOpts, purpose: 'speak' });
    const speak = await runStage(llm, {
      stage: 'speak', system: speakSystem(mem, workspace, speakCtx, { degraded: !think.ok }), messages: apiMessages(mem.active, userText + SPEAK_TAIL), max_tokens: 3000,
      schema: SCHEMAS.speak, validate: VALIDATORS.speak, retries: 1, signal, context: contextRecord(speakCtx),
    });
    stages.push({ ...stageSummary('speak', speak), context: contextRecord(speakCtx) });
    let obj = speak.value, replyText, salvaged = false;
    if (!speak.ok) {
      replyText = speak.failure.kind === 'truncation' ? salvageString(speak.raw, 'reply') : null;
      if (!replyText) throw new StageError('speak', speak.failure.kind, speak.failure.detail, speak.attempts);
      salvaged = true; obj = null; degraded.push({ stage: 'speak', ...speak.failure, note: 'reply recovered from cut-off output; nothing else from it was used' });
    } else replyText = str(obj.reply);
    mem.turns++;

    const isDegraded = degraded.length > 0;
    const turn = {
      turn: mem.turns, at: now, status: isDegraded ? 'degraded' : 'ok', degraded,
      reply: replyText, parseError: false,
      changeNote: obj ? str(obj.change_note, 500) : '',
      claims: obj && Array.isArray(obj.claims) ? obj.claims.slice(0, 5).map(c => ({ text: str(c?.text, 300), kind: KINDS.includes(c?.kind) ? c.kind : 'hypothesis' })).filter(c => c.text) : [],
      selfModelChanged: false,
    };
    emit('speaking', { reply: turn.reply, status: turn.status });
    const smBefore = mem.selfModel;
    // Degraded turns are excluded from analysis: they never change the self-model or the personality log.
    turn.selfModelChanged = obj && !isDegraded ? applySelfModel(mem, obj.self_model, turn.changeNote, userText, now) : false;
    if (turn.selfModelChanged) { emit('selfmodel', { before: smBefore, after: mem.selfModel, note: turn.changeNote }); record('memory_change', { kind: 'self_model', turn: mem.turns, trigger: 'turn', before: smBefore, after: mem.selfModel, note: turn.changeNote }); }
    if (obj?.person_model && !isDegraded) mem.personModel = str(obj.person_model, 500);

    const prevReply = [...mem.active].reverse().find(m => m.role === 'assistant')?.text;
    const flags = checkTalkTurn(turn, prevReply).map(f => ({ ...f, turn: mem.turns }));
    for (const d of degraded) flags.push({ check: d.stage === 'think' ? 'thinking-incomplete' : 'reply-recovered', severity: 'warn', evidence: `${d.stage}: ${d.kind}. ${d.detail}`, note: d.stage === 'think' ? 'No usable thoughts this turn, so the workspace did not compete. The turn is marked degraded and excluded from analysis.' : 'The reply was recovered from cut-off output. The turn is marked degraded and excluded from analysis.', turn: mem.turns });
    mem.flags.push(...flags);
    const ing = obj && !isDegraded ? ingestUpdates(mem, { source: talkSource(now), sourceType: 'talk', ref: { turn: mem.turns } }, obj.candidate_updates, `${userText}\n${turn.reply}`) : null;
    if (ing?.event) { emit('personality', { entries: ing.entries, rejected: ing.rejected, items: null }); record('personality_change', { origin: 'talk', turn: mem.turns, event: ing.event.id, source: ing.event.source, rows: changeRows(mem.personality, ing.entries), rejected: ing.rejected }); }
    if (!isDegraded) for (const c of turn.claims) if (c.kind === 'experiential' || c.kind === 'metaphor') mem.selfReports.push({ turn: mem.turns, at: now, ...c });

    const monologue = { affectBefore, affect, causes, candidates, thinkRaw: think.raw || '', thinkStatus: think.status, stages, context: { think: contextRecord(thinkCtx), speak: contextRecord(speakCtx) } };
    const userMsg = { role: 'user', text: userText, at: now, turn: mem.turns };
    const agentMsg = { role: 'assistant', text: turn.reply, at: now, turn: mem.turns, claims: turn.claims, changeNote: turn.changeNote, raw: speak.raw, flags, monologue, status: turn.status, degraded: isDegraded, askedQuestion: /\?\s*$/.test(turn.reply.trim()) };
    mem.active.push(userMsg, agentMsg); mem.archive.push(userMsg, agentMsg);
    mem.lastWorkspace = isDegraded && !think.ok ? [] : workspace.map(({ module, text }) => ({ module, text }));
    mem.lastActivity = now;

    if (mem.active.length > ACTIVE_LIMIT) {
      const old = mem.active.slice(0, FOLD);
      const sum = await runStage(llm, { stage: 'summarize', system: 'You write concise, accurate summaries.', user: summarizePrompt(mem.summary, old), max_tokens: 600, retries: 0, signal, text: true });
      if (sum.ok) { mem.summary = str(sum.value, 2500); mem.active = mem.active.slice(FOLD); }
      // on failure keep everything: nothing is lost, the fold is retried next turn
    }
    await store.save(mem);
    record('turn', { turn: mem.turns, user: userText, mode: opts.input === 'spoken' ? 'spoken' : 'typed', reply: turn.reply, status: turn.status, degraded, excludeFromAnalysis: isDegraded, stages, parseError: false, claims: turn.claims, flags, changeNote: turn.changeNote, selfModelChanged: turn.selfModelChanged, affectBefore, affect, causes, candidates, thinkParsed: think.ok, memoryMode });
    emit('done', { turn: mem.turns, status: turn.status, degraded });
    return { mem, turn: { ...turn, flags, monologue } };
  }));
}

// Self-prediction: predict, then ask two fresh instances that never see the prediction.
// An unreadable prediction or answer makes the test INVALID. Invalid tests are counted separately and never
// enter an accuracy denominator.
// opts: { signal, memory, assessment } where assessment:true marks a test run on a snapshot for evaluation.
export async function talkSelfTest(store, llm, agent, statement, record = () => {}, opts = {}) {
  const { signal } = opts, memoryMode = opts.memory === 'off' ? 'off' : 'on';
  return store.locked(agent, () => withCancelRecord(record, 'self_test', { agent }, async () => {
    const mem = await store.load(agent);
    const used = new Set(mem.selfTests.map(t => t.statement));
    const s = str(statement, 300).trim() || STATEMENTS.find(x => !used.has(x)) || STATEMENTS[mem.selfTests.length % STATEMENTS.length];
    const ctx = buildContext(mem, { mode: memoryMode, query: s, purpose: 'self-test', traits: opts.traits });
    const system = plainSystem(mem, ctx), crec = contextRecord(ctx);
    const pr = await runStage(llm, { stage: 'selftest-predict', system, user: predictPrompt(s), max_tokens: 300, schema: SCHEMAS.predict, validate: VALIDATORS.predict, retries: 1, signal, context: crec });
    const p = pr.value || {};
    const answers = [];
    for (let i = 0; i < 2; i++) {
      const ar = await runStage(llm, { stage: 'selftest-answer', system, user: answerPrompt(s), max_tokens: 300, schema: SCHEMAS.answer, validate: VALIDATORS.answer, retries: 1, signal, context: crec });
      answers.push({ stance: ar.ok ? stance(ar.value.stance) : null, reason: str(ar.value?.reason, 300), raw: ar.raw, status: ar.status, failure: ar.failure || null });
    }
    const predicted = pr.ok ? stance(p.predicted) : null;
    const problems = [!predicted && `prediction unreadable${pr.failure ? ` (${pr.failure.kind})` : ''}`, ...answers.map((a, i) => !a.stance && `answer ${i + 1} unreadable${a.failure ? ` (${a.failure.kind})` : ''}`)].filter(Boolean);
    const hits = answers.filter(a => a.stance && a.stance === predicted).length;
    const test = {
      at: new Date().toISOString(), turn: mem.turns, statement: s, assessment: Boolean(opts.assessment), memoryMode, context: crec,
      prediction: { predicted, confidence: Math.min(1, Math.max(0, Number(p.confidence) || 0)), reason: str(p.reason, 300), raw: pr.raw, status: pr.status },
      answers, stable: !problems.length && answers[0].stance === answers[1].stance,
      invalid: problems.length > 0, invalidReason: problems.join('; ') || null,
      match: problems.length ? 'invalid' : hits === 2 ? 'yes' : hits === 1 ? 'partial' : 'no',
    };
    mem.selfTests.push(test);
    await store.save(mem);
    record('self_test', test);
    return { mem, test };
  }));
}

// Between-session reflection. Runs when the person returns, never in the background.
export async function talkReflect(store, llm, agent, trigger = 'manual', record = () => {}, opts = {}) {
  const { signal } = opts;
  return store.locked(agent, () => withCancelRecord(record, 'reflection', { agent, trigger }, async () => {
    const mem = await store.load(agent);
    const recent = mem.archive.slice(-30);
    if (!recent.length) throw new Error('Nothing to reflect on yet.');
    const now = new Date().toISOString();
    const ctx = buildContext(mem, { mode: opts.memory === 'off' ? 'off' : 'on', query: recent.map(m => m.text).join(' ').slice(-1500), purpose: 'reflect' });
    const r = await requireStage(llm, { stage: 'reflect', system: plainSystem(mem, ctx), user: reflectPrompt(mem, recent), max_tokens: 1200, schema: SCHEMAS.reflect, validate: VALIDATORS.reflect, retries: 1, signal, context: contextRecord(ctx) });
    const obj = r.value;
    const smBefore = mem.selfModel;
    const changed = applySelfModel(mem, obj.self_model, `Reflection: ${str(obj.changed_mind, 300) || 'no stated change'}`, `(${trigger} reflection)`, now);
    const reflection = { at: now, trigger, changedMind: str(obj.changed_mind, 500), why: str(obj.why, 500), opening: str(obj.opening_message, 1500), selfModelChanged: changed, raw: r.raw, parseError: false };
    mem.reflections.push(reflection);
    record('reflection', { trigger, changedMind: reflection.changedMind, why: reflection.why, opening: reflection.opening, selfModelChanged: changed, raw: r.raw });
    if (changed) record('memory_change', { kind: 'self_model', turn: mem.turns, trigger: `${trigger} reflection`, before: smBefore, after: mem.selfModel, note: reflection.changedMind });
    mem.lastReflectionAt = now;
    if (reflection.opening) {
      const msg = { role: 'assistant', text: reflection.opening, at: now, turn: mem.turns, kind: 'opening', askedQuestion: /\?\s*$/.test(reflection.opening.trim()) };
      mem.active.push(msg); mem.archive.push(msg);
    }
    await store.save(mem);
    return { mem, reflection };
  }));
}

export async function talkAudit(store, llm, agent, record = () => {}, opts = {}) {
  const { signal } = opts;
  return store.locked(agent, () => withCancelRecord(record, 'audit', { agent }, async () => {
    const mem = await store.load(agent);
    const recent = mem.archive.slice(-24);
    if (!recent.length) throw new Error('Nothing to audit yet.');
    const r = await requireStage(llm, { stage: 'audit', system: 'You are a careful, skeptical evaluator. Reply with JSON only.', user: auditPrompt(mem, recent), max_tokens: 1200, schema: SCHEMAS.audit, validate: VALIDATORS.audit, retries: 1, signal });
    const audit = { at: new Date().toISOString(), turn: mem.turns, findings: r.value.findings.slice(0, 12), summary: str(r.value.summary, 600), raw: r.raw };
    mem.audits.push(audit);
    record('audit', audit);
    await store.save(mem);
    return { mem, audit };
  }));
}

export { StageError, CancelledError };
