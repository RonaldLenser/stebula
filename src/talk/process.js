// Turns recorded state into the process map the Agent and History views draw.
// Pure functions, no DOM. One reducer feeds live turns and replayed turns, so both are drawn the same way.
//
// Honesty rules enforced here:
//  - A node only holds what was recorded. A missing record is "missing", never an invented value.
//  - "Supplied to a later stage" (observable, from the recorded request) is kept apart from "caused" (never claimed).
//  - Every node says who produced it: the model, code, stored memory, or an observed input.
import { applyStage, brainFromMemory, emptyBrain, signalBoosts } from './brain.js';
import { CAPACITY } from './workspace.js';
import { PERSONAS } from '../agents/prompts.js';

// done: completed. partial: completed but something upstream failed. none: ran, nothing relevant to show.
// missing: nothing recorded. active: running now. waiting: not reached yet. failed / skipped as named.
export const STATUS_TEXT = { done: 'Completed', partial: 'Completed, incomplete process', none: 'No relevant result', missing: 'Nothing recorded', active: 'Still processing', waiting: 'Not reached yet', failed: 'Stage failed', skipped: 'Skipped' };

// Short words for the small chip on each map node.
export const SHORT_TEXT = { done: 'Completed', partial: 'Incomplete', none: 'None relevant', missing: 'Not recorded', active: 'Processing', waiting: 'Not reached', failed: 'Failed', skipped: 'Skipped' };

export const NODES = [
  { id: 'noticed', title: 'What it noticed', who: 'observed', row: 0 },
  { id: 'signals', title: 'Conversation signals', who: 'code', row: 0 },
  { id: 'memories', title: 'Relevant memories', who: 'memory', row: 0 },
  { id: 'priorities', title: 'Current priorities', who: 'config', row: 0 },
  { id: 'proposals', title: 'Proposals it considered', who: 'model', row: 1 },
  { id: 'selected', title: 'What was selected', who: 'code', row: 2 },
  { id: 'reply', title: 'What it said', who: 'model', row: 3 },
  { id: 'changes', title: 'What changed afterward', who: 'memory', row: 4 },
];
export const WHO_TEXT = { observed: 'Observed input', code: 'Computed by code', memory: 'Stored memory', config: 'Configured, plus its own notes', model: 'Model output' };

// Replay steps follow the recording granularity: one step per recorded stage group.
export const STEPS = [
  { id: 'noticed', label: 'What it noticed', reveals: ['noticed', 'memories', 'priorities'] },
  { id: 'signals', label: 'Conversation signals', reveals: ['signals'] },
  { id: 'proposals', label: 'Proposals', reveals: ['proposals'] },
  { id: 'selected', label: 'Selection', reveals: ['selected'] },
  { id: 'reply', label: 'Reply', reveals: ['reply'] },
  { id: 'changes', label: 'Saved changes', reveals: ['changes'] },
];

// Plain names for the five thought roles the prompt asks for. The role names are the prompt's, not brain regions.
export const ROLE_NAME = { perception: 'Reading the message', memory: 'Remembering', 'self-monitor': 'Watching itself', evaluation: 'Judging claims', initiative: 'Wanting to ask or do' };

// What the agent is doing, by what the stream has actually reported. Only stages the code emits are named.
export function activityLabel({ live, busy, readonly, hasModel = true } = {}) {
  if (readonly) return 'Showing a recorded example. Nothing is running';
  if (live) {
    const label = { idle: 'Sending your message', heard: 'Measuring conversation signals', affect: 'Generating proposals', thoughts: 'Selecting proposals', workspace: 'Writing a reply', speaking: 'Saving changes', done: 'Saving changes' }[live.phase];
    return label || 'Working';
  }
  if (busy) return String(busy).replace(/\.$/, '');
  return hasModel ? 'Waiting for your message' : 'Idle. No model is connected';
}

// ---------- stored-memory helpers ----------
export const agentMsg = (mem, t) => mem?.archive?.find(m => m.role === 'assistant' && m.turn === t && m.kind !== 'opening') ?? null;
export const userMsg = (mem, t) => mem?.archive?.find(m => m.role === 'user' && m.turn === t) ?? null;
export const turnList = mem => (mem ? [...new Set(mem.archive.filter(m => m.role === 'assistant' && m.kind !== 'opening').map(m => m.turn))] : []);

// The self-description as it stood at a moment, from the revision log. Never the current one unless nothing changed since.
export function selfAt(mem, at, { before = false } = {}) {
  const revs = (mem.revisions || []).filter(r => (before ? r.at < at : r.at <= at));
  if (revs.length) return revs.at(-1).after;
  return mem.revisions?.[0]?.before ?? (mem.revisions?.length ? { beliefs: [], uncertainties: [], openQuestions: [] } : mem.selfModel);
}
// Version = how many self-description changes had been saved by then.
export const versionAt = (mem, at) => (mem.revisions || []).filter(r => r.at <= at).length;

const talkEvents = (mem, t) => (mem.personality?.events || []).filter(e => e.sourceType === 'talk' && e.ref?.turn === t);
export const evidenceAt = (mem, t) => { const ids = new Set(talkEvents(mem, t).map(e => e.id)); return (mem.personality?.log || []).filter(l => ids.has(l.eventId)); };

// Reading memories that existed at a moment. Folded ones are not reconstructable and the view says so.
export const episodesAt = (mem, at) => (mem.episodes || []).filter(e => e.kind !== 'summary' && e.at <= at);
export const foldedInto = (mem, id) => (mem.episodes || []).find(e => e.kind === 'summary' && (e.covers || []).includes(id)) ?? null;

export function whatChanged(mem, t) {
  const a = agentMsg(mem, t);
  if (!a) return { text: '', did: false, parts: [] };
  const parts = [];
  const rev = (mem.revisions || []).find(r => r.turn === t && !String(r.trigger).startsWith('('));
  if (rev) {
    const keys = ['beliefs', 'uncertainties', 'openQuestions'];
    const add = keys.reduce((n, k) => n + (rev.after[k] || []).filter(x => !(rev.before[k] || []).includes(x)).length, 0);
    const rem = keys.reduce((n, k) => n + (rev.before[k] || []).filter(x => !(rev.after[k] || []).includes(x)).length, 0);
    parts.push(`Self-description changed (${add} added, ${rem} removed)`);
  }
  const ev = evidenceAt(mem, t);
  if (ev.length) parts.push(`Evidence ${ev.map(e => `${e.direction === 'supports' ? 'for' : 'against'} "${e.name}"`).join(', ')}`);
  if (a.degraded) parts.unshift('Degraded turn: the proposal step failed, so it is excluded from analysis');
  return parts.length ? { text: `${parts.join('. ')}.`, did: true, parts } : { text: 'Nothing in stored memory changed.', did: false, parts };
}

// ---------- the process map ----------
const supplied = c => (c?.supplied || []);
const nameList = xs => xs.map(x => x.id).join(', ');

// Builds the whole map for one turn. `mem` is the stored memory (may be null while a first turn is live).
// `live` is a brain state from applyStage when a turn is in progress. `turn` selects a stored turn.
export function processModel({ mem = null, turn = null, live = null, agent = mem?.agent ?? 'A' } = {}) {
  const isLive = !!live;
  const stored = !isLive && mem && turn != null ? brainFromMemory(mem, turn) : null;
  const b = isLive ? live : stored ?? emptyBrain();
  const t = isLive ? live.turn : turn;
  const A = !isLive && mem && t != null ? agentMsg(mem, t) : null, M = A?.monologue ?? null;
  const known = isLive || !!stored;
  const phase = isLive ? live.phase : 'done';
  const reached = k => !isLive || ['heard', 'affect', 'thoughts', 'workspace', 'speaking', 'selfmodel', 'done'].indexOf(phase) >= ['heard', 'affect', 'thoughts', 'workspace', 'speaking', 'selfmodel', 'done'].indexOf(k);
  const thinkFailed = b.thinkStatus === 'failed';
  const at = A?.at ?? null;
  const nodes = {};
  const put = (id, o) => { nodes[id] = { id, ...NODES.find(n => n.id === id), items: [], note: '', ...o }; };

  // noticed
  put('noticed', {
    status: b.heard ? 'done' : known ? 'missing' : 'waiting',
    summary: b.heard ? `Your message: "${b.heard.slice(0, 160)}${b.heard.length > 160 ? '...' : ''}"` : 'No message selected.',
    detail: b.heard, note: 'The text you sent, exactly as received. It also goes straight to the reply step.',
  });

  // signals
  const aff = b.affect;
  put('signals', {
    status: aff ? 'done' : isLive ? (reached('affect') ? 'done' : 'waiting') : known ? 'missing' : 'waiting',
    summary: aff ? `Surprise ${aff.surprise}, conflict ${aff.conflict}, curiosity ${aff.curiosity}` : known && !isLive ? 'No signal values were recorded for this turn.' : 'Not measured yet.',
    items: aff ? [['surprise', 'Surprise'], ['conflict', 'Conflict'], ['curiosity', 'Curiosity']].map(([k, name]) => ({ key: k, name, value: aff[k], before: M?.affectBefore?.[k] ?? null })) : [],
    causes: b.causes || [], boosts: signalBoosts(aff),
    note: 'Numbers a rule computes from the conversation. They are not feelings. They are written into the thinking prompt and nudge which proposal is selected. The reply step does not receive them.',
  });

  // memories
  const ctxT = M?.context?.think, ctxS = M?.context?.speak;
  let mem_status = 'waiting', mem_summary = 'Recorded when the turn is saved.', memItems = [];
  if (!isLive || (isLive && !M)) { /* live: nothing recorded until save */ }
  if (A) {
    if (!ctxS && !ctxT) { mem_status = 'missing'; mem_summary = 'Which memories were supplied was not recorded for this turn.'; }
    else if ((ctxS || ctxT).mode === 'off') { mem_status = 'none'; mem_summary = 'Memory was switched off. No stored memory was given to the model.'; }
    else {
      const ids = new Map();
      for (const [stage, c] of [['think', ctxT], ['speak', ctxS]]) for (const s of supplied(c)) { const e = ids.get(s.id) ?? { ...s, to: [] }; e.to.push(stage === 'think' ? 'thinking' : 'reply'); ids.set(s.id, e); }
      memItems = [...ids.values()];
      mem_status = memItems.length ? 'done' : 'none';
      mem_summary = memItems.length ? `${memItems.length} stored reading${memItems.length > 1 ? 's' : ''} supplied: ${nameList(memItems)}.` : `No stored reading matched this message (${(ctxS || ctxT).available} stored).`;
    }
  }
  const selfSupplied = A && (ctxS || ctxT)?.mode === 'on';
  put('memories', {
    matched: (ctxS || ctxT)?.matched ?? null, available: (ctxS || ctxT)?.available ?? null,
    status: mem_status, summary: mem_summary, items: memItems, ctx: { think: ctxT ?? null, speak: ctxS ?? null },
    always: selfSupplied ? ['its written self-description', 'its note about the person', 'a summary of older conversation', 'lessons it wrote down'] : [],
    window: 'The recent conversation is supplied either way, even when stored memory is off.',
    note: 'A memory listed here was given to the model. That shows it was available. It does not show the memory caused the reply.',
  });

  // priorities
  const prevAgent = known && t > 1 && mem ? [...(mem.archive || [])].reverse().find(m => m.role === 'assistant' && m.turn < t && m.kind !== 'opening') : null;
  const carried = prevAgent?.monologue?.candidates?.filter(c => c.won) ?? [];
  // The questions it held when the turn began: the self-description before this turn's own change.
  const openQs = (mem && at ? selfAt(mem, at, { before: true }) : mem && isLive ? mem.selfModel : null)?.openQuestions ?? [];
  const stance = PERSONAS[agent]?.stance ?? '';
  put('priorities', {
    status: known ? 'done' : 'waiting',
    summary: 'No separate goal list exists. What steers it is its configured stance, its own open questions, and what it paid attention to last turn.',
    items: [
      { kind: 'stance', source: 'Configured in code (src/agents/prompts.js)', text: stance, to: 'thinking and reply' },
      { kind: 'open-questions', source: 'Written earlier by the agent, stored in memory', list: openQs, to: 'thinking and reply, only when memory is on', recorded: !!(mem && (at || isLive)) },
      { kind: 'carried', source: 'Selected last turn by code', list: carried.map(c => `${ROLE_NAME[c.module] || c.module}: ${c.text}`), to: 'thinking', recorded: !!prevAgent?.monologue },
    ],
    note: 'Motives only appear if the agent proposed one as evidence in its personality record. That record is kept for evaluation and is not shown to the agent.',
  });

  // proposals
  let pStatus = 'waiting', pSummary = 'Not generated yet.';
  if (thinkFailed) { pStatus = 'failed'; pSummary = `The proposal step failed (${b.thinkFailure?.kind || 'unknown'}). No proposals were recorded.`; }
  else if (b.candidates.length) { pStatus = 'done'; pSummary = `${b.candidates.length} proposals, one per thought role.`; }
  else if (isLive) { pStatus = reached('affect') ? 'active' : 'waiting'; pSummary = pStatus === 'active' ? 'The model is writing its candidate thoughts.' : 'Not reached yet.'; }
  else if (known) { pStatus = 'missing'; pSummary = 'No proposals were recorded for this turn. It may predate recording of the thinking step.'; }
  put('proposals', {
    status: pStatus, summary: pSummary, candidates: b.candidates, failure: b.thinkFailure,
    attempts: M?.stages?.find(s => s.stage === 'think')?.attempts?.length ?? null,
    note: 'Written by the model in answer to a prompt. They are records the application keeps, not a transcript of the model\'s private reasoning.',
  });

  // selected
  const won = b.candidates.filter(c => c.won);
  let sStatus = 'waiting', sSummary = 'Not reached yet.';
  if (thinkFailed) { sStatus = 'skipped'; sSummary = 'Skipped. Without proposals there was nothing to choose from.'; }
  else if (won.length) { sStatus = 'done'; sSummary = `${won.map(c => ROLE_NAME[c.module] || c.module).join(' and ')} reached the reply step. The rest were dropped.`; }
  else if (isLive) { sStatus = b.candidates.length || reached('workspace') ? 'active' : 'waiting'; sSummary = sStatus === 'active' ? 'Code is scoring the proposals.' : 'Not reached yet.'; }
  else if (known) { sStatus = 'missing'; sSummary = 'Nothing was recorded about a selection for this turn.'; }
  put('selected', {
    status: sStatus, summary: sSummary, winners: won, dropped: b.candidates.filter(c => !c.won),
    rule: `Score = the model's own relevance rating + a boost from the matching signal - a penalty for repeating last turn. Only the top ${CAPACITY} scores go on.`,
    note: 'Chosen by a fixed rule in code, not by the model.',
  });

  // reply
  const degraded = b.turnStatus === 'degraded' || !!A?.degraded;
  let rStatus = 'waiting', rSummary = 'Not written yet.';
  if (b.reply) { rStatus = degraded && thinkFailed ? 'partial' : 'done'; rSummary = degraded && thinkFailed ? 'Written without any proposals, so the process behind it is incomplete.' : `${(b.reply.length > 140 ? `${b.reply.slice(0, 140)}...` : b.reply)}`; }
  else if (isLive) { rStatus = reached('workspace') ? 'active' : 'waiting'; rSummary = rStatus === 'active' ? 'The model is writing the reply.' : 'Not reached yet.'; }
  else if (known) { rStatus = 'missing'; rSummary = 'No reply was recorded.'; }
  const gotMemory = !!selfSupplied;
  put('reply', {
    status: rStatus, summary: rSummary, detail: b.reply, claims: A?.claims ?? [], degraded,
    inputs: [
      { id: 'noticed', label: 'Your message', given: !!b.heard },
      { id: 'selected', label: `Selected proposals (${won.length})`, given: won.length > 0 },
      { id: 'memories', label: gotMemory ? 'Stored memory: self-description, note about the person, summary, lessons' : 'Stored memory', given: gotMemory },
      { id: 'memories', label: `Reading memories (${supplied(ctxS).length})`, given: supplied(ctxS).length > 0 },
      { id: 'priorities', label: 'Its configured stance', given: true },
      { id: 'noticed', label: 'The recent conversation', given: true },
    ],
    notGiven: ['the proposals that were dropped', 'the conversation signal values', 'the personality trait scores'],
    note: 'Written by the model. It saw the inputs listed here, and nothing else.',
  });

  // changes
  const wc = A ? whatChanged(mem, t) : null;
  const rev = A ? (mem.revisions || []).find(r => r.turn === t && !String(r.trigger).startsWith('(')) : null;
  const ev = A ? evidenceAt(mem, t) : [];
  const reports = A ? (mem.selfReports || []).filter(r => r.turn === t) : [];
  let cStatus = 'waiting', cSummary = 'Saved when the reply is done.';
  if (A) { cStatus = A.degraded ? 'skipped' : wc.did ? 'done' : 'none'; cSummary = A.degraded ? 'A degraded turn changes no memory and is excluded from analysis.' : wc.text; }
  else if (!isLive && known) { cStatus = 'missing'; cSummary = 'Nothing recorded.'; }
  else if (isLive && b.saveFailed) { cStatus = 'failed'; cSummary = 'Saving failed. Nothing from this turn was stored.'; }
  else if (isLive && b.phase === 'done') { cStatus = 'done'; cSummary = 'Saved.'; }
  put('changes', {
    status: cStatus, summary: cSummary, revision: rev, evidence: ev, reports, change: wc,
    note: 'Only records that changed are listed. The note about the person is replaced each time and its history is not kept.',
  });

  // Words for each status chip. The status stays the same; the words say what actually happened.
  const memOff = (ctxS || ctxT)?.mode === 'off';
  const words = { memories: { none: memOff ? ['Memory switched off', 'Memory off'] : ['No relevant memory', 'None relevant'] }, changes: { none: ['Nothing changed', 'No change'], failed: ['Saving failed', 'Not saved'] } };
  for (const n of Object.values(nodes)) { const w = words[n.id]?.[n.status]; n.label = w?.[0] ?? STATUS_TEXT[n.status]; n.short = w?.[1] ?? SHORT_TEXT[n.status]; }

  // Connections. `given` is what the recorded request shows was supplied, never what caused an effect.
  const memOn = !!selfSupplied;
  const edges = [
    { id: 'noticed-signals', from: 'noticed', to: 'signals', kind: 'compute', label: 'measured', text: 'Code compares your message with your earlier ones and looks for challenge wording to set the signals.', given: !!aff },
    { id: 'noticed-proposals', from: 'noticed', to: 'proposals', kind: 'supply', label: 'message', text: 'Your message is part of what the thinking step receives.', given: !!b.heard },
    { id: 'signals-proposals', from: 'signals', to: 'proposals', kind: 'supply', label: 'values', text: 'The three signal values are written into the thinking prompt as text.', given: !!aff },
    { id: 'memories-proposals', from: 'memories', to: 'proposals', kind: 'supply', label: memOn ? 'supplied' : 'not supplied', text: memOn ? `Supplied to thinking: ${supplied(ctxT).length} reading${supplied(ctxT).length === 1 ? '' : 's'}, plus its self-description and notes.` : 'Stored memory was not supplied to the thinking step.', given: memOn },
    { id: 'priorities-proposals', from: 'priorities', to: 'proposals', kind: 'supply', label: 'steers', text: 'Its stance, open questions (memory on only) and last turn\'s selection are in the thinking prompt.', given: known },
    { id: 'signals-selected', from: 'signals', to: 'selected', kind: 'score', label: 'boost', text: 'Each signal adds a boost to one proposal\'s score. This changes which proposals are selected.', given: !!aff && b.candidates.length > 0 },
    { id: 'proposals-selected', from: 'proposals', to: 'selected', kind: 'compute', label: 'scored', text: `Code scores each proposal and keeps the top ${CAPACITY}.`, given: b.candidates.length > 0 },
    { id: 'selected-reply', from: 'selected', to: 'reply', kind: 'supply', label: 'selected only', text: 'Only the selected proposals are given to the reply step.', given: won.length > 0 },
    { id: 'noticed-reply', from: 'noticed', to: 'reply', kind: 'direct', label: 'direct', text: 'Your message goes straight to the reply step as well.', given: !!b.heard },
    { id: 'memories-reply', from: 'memories', to: 'reply', kind: 'direct', label: memOn ? 'direct' : 'not supplied', text: memOn ? `Supplied straight to the reply: ${supplied(ctxS).length} reading${supplied(ctxS).length === 1 ? '' : 's'}, plus its self-description and notes.` : 'Stored memory was not supplied to the reply step.', given: memOn },
    { id: 'priorities-reply', from: 'priorities', to: 'reply', kind: 'direct', label: 'direct', text: 'Its stance and open questions (memory on only) are in the reply prompt.', given: known },
    { id: 'reply-changes', from: 'reply', to: 'changes', kind: 'save', label: 'saved', text: 'The reply step also proposes updates. Code decides what is saved to memory.', given: !!A && !A.degraded },
  ];

  const overall = !known ? { state: 'unrecorded', text: 'Nothing selected.' }
    : isLive && b.saveFailed ? { state: 'save-failed', text: 'The reply was written but could not be saved.' }
    : isLive ? { state: 'processing', text: 'Turn in progress.' }
    : !M ? { state: 'unrecorded', text: 'This turn has no recorded process.' }
    : thinkFailed ? { state: 'incomplete', text: 'Incomplete: the proposal step failed, so the reply was written without proposals.' }
    : degraded ? { state: 'incomplete', text: 'Incomplete: part of the process was recovered or failed.' }
    : { state: 'complete', text: 'Every stage completed.' };

  return { turn: t ?? null, agent, at, live: isLive, nodes, edges, overall, events: M?.events ?? null };
}

// ---------- history ----------
// A chronological list of recorded moments. Each has the time it was recorded, so state can be shown "as of then".
export function historyMoments(mem) {
  if (!mem) return [];
  const out = [];
  for (const m of mem.archive || []) {
    if (m.role !== 'assistant') continue;
    if (m.kind === 'opening') { out.push({ id: `open-${m.at}`, kind: 'reflection-opening', at: m.at, title: 'Opening message after a review', summary: m.text.slice(0, 120) }); continue; }
    const u = userMsg(mem, m.turn);
    out.push({ id: `turn-${m.turn}`, kind: 'turn', turn: m.turn, at: m.at, title: `Turn ${m.turn}`, summary: (u?.text || '').slice(0, 100), degraded: !!m.degraded, changed: whatChanged(mem, m.turn).did });
  }
  for (const r of mem.reflections || []) out.push({ id: `refl-${r.at}`, kind: 'reflection', at: r.at, title: 'Reflection', summary: r.changedMind || 'nothing changed', trigger: r.trigger });
  for (const e of mem.episodes || []) out.push({ id: `ep-${e.id}`, kind: e.kind === 'summary' ? 'fold' : 'reading', at: e.at, title: e.kind === 'summary' ? 'Older readings folded into a summary' : `Read: ${e.source}, passage ${e.passage}`, summary: (e.summary || '').slice(0, 120), episode: e.id });
  for (const t of mem.selfTests || []) out.push({ id: `test-${t.at}`, kind: 'test', at: t.at, title: 'Self-prediction test', summary: t.statement, match: t.match });
  for (const a of mem.audits || []) out.push({ id: `audit-${a.at}`, kind: 'audit', at: a.at, title: 'Audit by a second model call', summary: a.summary || '' });
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// The state recorded at a moment, with explicit gaps for what cannot be reconstructed.
export function stateAt(mem, at) {
  const eps = episodesAt(mem, at);
  const turns = turnList(mem).filter(t => (agentMsg(mem, t)?.at ?? '') <= at);
  const lastTurn = turns.at(-1) ?? null;
  const mono = lastTurn ? agentMsg(mem, lastTurn)?.monologue : null;
  const folded = (mem.episodes || []).filter(e => e.kind === 'summary' && e.at > at).flatMap(e => e.covers || []);
  return {
    at, version: versionAt(mem, at), self: selfAt(mem, at), turns: turns.length, lastTurn,
    readings: eps, affect: mono?.affect ?? null,
    traitEvidence: (mem.personality?.log || []).filter(l => (mem.personality.events || []).find(e => e.id === l.eventId)?.at <= at).length,
    gaps: [
      'The note about the person is stored as its latest text only, so its earlier versions are not available.',
      'The running summary of older conversation is stored as its latest text only.',
      ...(folded.length ? [`${folded.length} reading memor${folded.length > 1 ? 'ies were' : 'y was'} later folded into a summary and ${folded.length > 1 ? 'are' : 'is'} not shown separately.`] : []),
    ],
  };
}

// Used by the live view: apply a stream event and return the new brain state.
export { applyStage, emptyBrain };
