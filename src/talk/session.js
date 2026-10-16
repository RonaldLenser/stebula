// Server-side Talk sessions. Memory persists to data/talk-<agent>.json between restarts.
// A turn is two model calls: THINK (five candidate thoughts) then SPEAK (sees only the winners).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { extractJson, salvageString } from '../agents/parse.js';
import { PERSONAS } from '../agents/prompts.js';
import { thinkSystem, speakSystem, THINK_TAIL, SPEAK_TAIL, predictPrompt, answerPrompt, plainSystem, reflectPrompt, summarizePrompt, auditPrompt } from './prompts.js';
import { checkTalkTurn } from './checks.js';
import { freshAffect, updateAffect, compete, MODULES } from './workspace.js';
import { STATEMENTS } from './statements.js';

const ACTIVE_LIMIT = 40, FOLD = 20, REFLECT_AFTER_MS = 30 * 60 * 1000;
const RETRY_TAIL = '\n\nYour previous answer was cut off or was not valid JSON. Reply again with only the JSON object. Keep "reply" under 150 words and each self-model item under 20 words.';
const KINDS = ['metaphor', 'hypothesis', 'behavioral', 'experiential'];
const STANCES = ['agree', 'disagree', 'unsure'];
const str = (x, n = 4000) => (x == null ? '' : String(x)).slice(0, n);
const arr = (x, n) => (Array.isArray(x) ? x.slice(0, n).map(v => str(v, 300)).filter(Boolean) : null);
const stance = x => { const s = String(x || '').toLowerCase(); return STANCES.find(v => s.startsWith(v)) || null; };

export const freshTalkMemory = agent => ({
  format: 'threshold-talk/2', agent, createdAt: new Date().toISOString(), lastActivity: null, lastReflectionAt: null,
  version: 0, turns: 0,
  selfModel: { beliefs: [], uncertainties: [], openQuestions: [] },
  personModel: '', summary: '',
  affect: freshAffect(), lastWorkspace: [],
  active: [], archive: [],
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

export function makeTalkStore(dir) {
  const file = agent => path.join(dir, `talk-${agent}.json`);
  const locks = {};
  return {
    async load(agent) {
      if (!PERSONAS[agent]) throw new Error(`Unknown agent ${agent}`);
      try { return migrate(JSON.parse(await readFile(file(agent), 'utf8')), agent); } catch { return freshTalkMemory(agent); }
    },
    async save(mem) { await mkdir(dir, { recursive: true }); await writeFile(file(mem.agent), JSON.stringify(mem, null, 1)); },
    async locked(agent, fn) { const prev = locks[agent] || Promise.resolve(); let done; locks[agent] = new Promise(r => (done = r)); await prev; try { return await fn(); } finally { done(); } },
  };
}

export const needsReflection = mem =>
  Boolean(mem.lastActivity && mem.turns > 0 && Date.now() - Date.parse(mem.lastActivity) > REFLECT_AFTER_MS &&
    (!mem.lastReflectionAt || Date.parse(mem.lastReflectionAt) < Date.parse(mem.lastActivity)));

// The API needs alternating roles starting with the user. Openings from reflection break that, so merge.
function apiMessages(active, finalUser) {
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

// `emit(stage, data)` is called as each stage finishes, so a caller can stream progress.
// Stages: heard, affect, thoughts, workspace, speaking, selfmodel (only if changed), done.
export async function talkTurn(store, llm, agent, text, emit = () => {}) {
  return store.locked(agent, async () => {
    const mem = await store.load(agent);
    const now = new Date().toISOString();
    const userText = str(text, 4000);
    emit('heard', { turn: mem.turns + 1, text: userText });

    // 1. Affect update (code)
    const priorUser = mem.archive.filter(m => m.role === 'user').map(m => m.text).slice(-10);
    const lastTest = mem.selfTests.at(-1);
    const recentMiss = Boolean(lastTest && lastTest.match === 'no' && Date.parse(lastTest.at) > (mem.lastActivity ? Date.parse(mem.lastActivity) : 0));
    const affectBefore = mem.affect;
    const { affect, causes } = updateAffect(mem.affect, userText, priorUser, recentMiss);
    mem.affect = affect;
    emit('affect', { before: affectBefore, after: affect, causes });

    // 2. THINK: five candidate thoughts
    const thinkSys = thinkSystem(mem, affect);
    const thinkRaw = await llm({ system: thinkSys, messages: apiMessages(mem.active, userText + THINK_TAIL), max_tokens: 900 });
    const thinkObj = extractJson(thinkRaw);
    const thoughts = Array.isArray(thinkObj?.thoughts) ? thinkObj.thoughts : [];

    // 3. Workspace competition (code)
    const candidates = compete(thoughts, affect, mem.lastWorkspace.map(t => t.text));
    const workspace = candidates.filter(t => t.won);
    emit('thoughts', { candidates });
    emit('workspace', { winners: workspace.map(({ module, text, score }) => ({ module, text, score })) });

    // 4. SPEAK: sees only the workspace
    const speakSys = speakSystem(mem, workspace);
    let raw = await llm({ system: speakSys, messages: apiMessages(mem.active, userText + SPEAK_TAIL), max_tokens: 3000 });
    let obj = extractJson(raw);
    if (!obj || !obj.reply) { // cut off or malformed: one retry with a firmer, shorter brief
      const retry = await llm({ system: speakSys, messages: apiMessages(mem.active, userText + SPEAK_TAIL + RETRY_TAIL), max_tokens: 3000 });
      const obj2 = extractJson(retry);
      raw = `${raw}\n\n[retry]\n${retry}`;
      if (obj2?.reply) obj = obj2;
    }
    const salvaged = !obj?.reply ? salvageString(raw, 'reply') : null;
    mem.turns++;

    const turn = {
      turn: mem.turns, at: now, parseError: !obj?.reply,
      reply: obj?.reply ? str(obj.reply) : str(salvaged || 'I produced output the app could not read. The raw text is under "Raw output".'),
      changeNote: obj?.reply ? str(obj.change_note, 500) : '',
      claims: obj?.reply && Array.isArray(obj.claims) ? obj.claims.slice(0, 5).map(c => ({ text: str(c?.text, 300), kind: KINDS.includes(c?.kind) ? c.kind : 'hypothesis' })).filter(c => c.text) : [],
      selfModelChanged: false,
    };
    emit('speaking', { reply: turn.reply });
    const smBefore = mem.selfModel;
    turn.selfModelChanged = obj?.reply ? applySelfModel(mem, obj.self_model, turn.changeNote, userText, now) : false;
    if (turn.selfModelChanged) emit('selfmodel', { before: smBefore, after: mem.selfModel, note: turn.changeNote });
    if (obj?.reply && obj.person_model) mem.personModel = str(obj.person_model, 500);

    const prevReply = [...mem.active].reverse().find(m => m.role === 'assistant')?.text;
    const flags = checkTalkTurn(turn, prevReply).map(f => ({ ...f, turn: mem.turns }));
    if (!thinkObj || candidates.length < MODULES.length) flags.push({ check: 'thinking-incomplete', severity: 'warn', evidence: `${candidates.length} of ${MODULES.length} processes produced a usable thought${thinkRaw ? '' : ' (the thinking call returned no text; see the server log for the stop reason)'}`, note: 'The workspace competed over fewer thoughts than designed.', turn: mem.turns });
    mem.flags.push(...flags);
    for (const c of turn.claims) if (c.kind === 'experiential' || c.kind === 'metaphor') mem.selfReports.push({ turn: mem.turns, at: now, ...c });

    const monologue = { affectBefore, affect, causes, candidates, thinkRaw };
    const userMsg = { role: 'user', text: userText, at: now, turn: mem.turns };
    const agentMsg = { role: 'assistant', text: turn.reply, at: now, turn: mem.turns, claims: turn.claims, changeNote: turn.changeNote, raw, flags, monologue, askedQuestion: /\?\s*$/.test(turn.reply.trim()) };
    mem.active.push(userMsg, agentMsg); mem.archive.push(userMsg, agentMsg);
    mem.lastWorkspace = workspace.map(({ module, text }) => ({ module, text }));
    mem.lastActivity = now;

    if (mem.active.length > ACTIVE_LIMIT) {
      const old = mem.active.slice(0, FOLD);
      try { mem.summary = str(await llm({ system: 'You write concise, accurate summaries.', user: summarizePrompt(mem.summary, old), max_tokens: 600 }), 2500); mem.active = mem.active.slice(FOLD); }
      catch { /* keep everything if summarizing fails */ }
    }
    await store.save(mem);
    emit('done', { turn: mem.turns });
    return { mem, turn: { ...turn, flags, monologue } };
  });
}

// Self-prediction: predict, then ask two fresh instances that never see the prediction.
export async function talkSelfTest(store, llm, agent, statement) {
  return store.locked(agent, async () => {
    const mem = await store.load(agent);
    const used = new Set(mem.selfTests.map(t => t.statement));
    const s = str(statement, 300).trim() || STATEMENTS.find(x => !used.has(x)) || STATEMENTS[mem.selfTests.length % STATEMENTS.length];
    const system = plainSystem(mem);
    const pRaw = await llm({ system, user: predictPrompt(s), max_tokens: 300 });
    const p = extractJson(pRaw) || {};
    const answers = [];
    for (let i = 0; i < 2; i++) {
      const aRaw = await llm({ system, user: answerPrompt(s), max_tokens: 300 });
      const a = extractJson(aRaw) || {};
      answers.push({ stance: stance(a.stance), reason: str(a.reason, 300), raw: aRaw });
    }
    const predicted = stance(p.predicted);
    const hits = answers.filter(a => a.stance && a.stance === predicted).length;
    const test = {
      at: new Date().toISOString(), turn: mem.turns, statement: s,
      prediction: { predicted, confidence: Math.min(1, Math.max(0, Number(p.confidence) || 0)), reason: str(p.reason, 300), raw: pRaw },
      answers, stable: answers[0].stance != null && answers[0].stance === answers[1].stance,
      match: !predicted ? 'invalid' : hits === 2 ? 'yes' : hits === 1 ? 'partial' : 'no',
    };
    mem.selfTests.push(test);
    await store.save(mem);
    return { mem, test };
  });
}

// Between-session reflection. Runs when the person returns, never in the background.
export async function talkReflect(store, llm, agent, trigger = 'manual') {
  return store.locked(agent, async () => {
    const mem = await store.load(agent);
    const recent = mem.archive.slice(-30);
    if (!recent.length) throw new Error('Nothing to reflect on yet.');
    const now = new Date().toISOString();
    const raw = await llm({ system: plainSystem(mem), user: reflectPrompt(mem, recent), max_tokens: 1200 });
    const obj = extractJson(raw) || {};
    const changed = applySelfModel(mem, obj.self_model, `Reflection: ${str(obj.changed_mind, 300) || 'no stated change'}`, `(${trigger} reflection)`, now);
    const reflection = { at: now, trigger, changedMind: str(obj.changed_mind, 500), why: str(obj.why, 500), opening: str(obj.opening_message, 1500), selfModelChanged: changed, raw, parseError: !extractJson(raw) };
    mem.reflections.push(reflection);
    mem.lastReflectionAt = now;
    if (reflection.opening) {
      const msg = { role: 'assistant', text: reflection.opening, at: now, turn: mem.turns, kind: 'opening', askedQuestion: /\?\s*$/.test(reflection.opening.trim()) };
      mem.active.push(msg); mem.archive.push(msg);
    }
    await store.save(mem);
    return { mem, reflection };
  });
}

export async function talkAudit(store, llm, agent) {
  return store.locked(agent, async () => {
    const mem = await store.load(agent);
    const recent = mem.archive.slice(-24);
    if (!recent.length) throw new Error('Nothing to audit yet.');
    const raw = await llm({ system: 'You are a careful, skeptical evaluator. Reply with JSON only.', user: auditPrompt(mem, recent), max_tokens: 1200 });
    const obj = extractJson(raw) || { findings: [], summary: 'Evaluator output was not valid JSON.' };
    const audit = { at: new Date().toISOString(), turn: mem.turns, findings: Array.isArray(obj.findings) ? obj.findings.slice(0, 12) : [], summary: str(obj.summary, 600), raw };
    mem.audits.push(audit);
    await store.save(mem);
    return { mem, audit };
  });
}
