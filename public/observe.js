// Observe: the conversation (about two thirds of the width) and one contextual inspector for whatever turn is
// selected. Everything shown comes from the stream of the turn in progress or from the stored memory file.
import { $, $$, esc, fmt, sign, isNum, pct, when, pref, setPref, api, stream, ApiError, config, tabKeys } from '/core.js';
import { emptyBrain, applyStage, brainFromMemory, signalBoosts, storedTurns } from '/src/talk/brain.js';
import { CAPACITY, MODULES } from '/src/talk/workspace.js';
import { buildItems } from '/src/talk/personality.js';
import { initBrain, paintBrain, REGIONS } from '/brain.js';
import { renderGrowth, initGrowth } from '/growth.js';

const S = {
  agent: 'A', mem: null, busy: null, job: null, error: null, pending: null, live: null,
  sel: null, tab: 'process', memoryOn: true, example: null, exampleAvailable: false, readonly: false, region: null,
  digest: { running: false, status: '', rejected: 0, resumeAt: null, form: { title: '', source: '', text: '' } },
  lastSent: null, nextInput: 'typed',
};
const AGENT_LABEL = { A: 'Agent A (empiricist)', B: 'Agent B (analogist)' };
const STEPS = [['heard', 'Heard'], ['affect', 'Signals'], ['thoughts', 'Proposals'], ['workspace', 'Selection'], ['speaking', 'Reply'], ['done', 'Saved']];
const PHASE = { idle: -1, heard: 0, affect: 1, thoughts: 2, workspace: 3, speaking: 4, done: 5 };
const RECOVERY = { refusal: 'Reword the message and send it again. The provider declined this request.', truncation: 'The reply was cut off. Try a shorter message, or retry.', malformed: 'The model returned something unreadable twice. Retry.', schema: 'The model returned the wrong shape of answer twice. Retry.', empty: 'The model returned no text. Retry.', transport: 'The model service did not answer. Check your connection and retry.', timeout: 'The model took too long. Retry.' };

// ---------- derived views of the stored memory ----------
const turnsOf = () => (S.mem ? storedTurns(S.mem) : []);
const latest = () => turnsOf().at(-1) ?? null;
const viewTurn = () => (S.live ? null : S.sel ?? latest());
const isReplay = () => !S.live && S.sel != null && S.sel !== latest();
const agentMsg = (mem, t) => mem?.archive.find(m => m.role === 'assistant' && m.turn === t && m.kind !== 'opening');
const emptySelf = () => ({ beliefs: [], uncertainties: [], openQuestions: [] });
const selfAt = (mem, t) => (mem.revisions.filter(r => r.turn <= t).at(-1)?.after ?? emptySelf());
const talkEntries = (mem, t) => mem.personality.log.filter(l => { const e = mem.personality.events.find(x => x.id === l.eventId); return e?.sourceType === 'talk' && e.ref?.turn === t; });
const memoryMode = m => m?.monologue?.context?.speak?.mode ?? 'on';

// One short sentence on what this turn changed in stored memory.
function whatChanged(mem, t) {
  const a = agentMsg(mem, t);
  if (!a) return { text: '', did: false };
  const parts = [];
  const rev = mem.revisions.find(r => r.turn === t && !String(r.trigger).startsWith('('));
  if (rev) {
    const add = ['beliefs', 'uncertainties', 'openQuestions'].reduce((n, k) => n + (rev.after[k] || []).filter(x => !(rev.before[k] || []).includes(x)).length, 0);
    const rem = ['beliefs', 'uncertainties', 'openQuestions'].reduce((n, k) => n + (rev.before[k] || []).filter(x => !(rev.after[k] || []).includes(x)).length, 0);
    parts.push(`Self-description changed (${add} added, ${rem} removed)`);
  }
  const ev = talkEntries(mem, t);
  if (ev.length) parts.push(`Evidence ${ev.map(e => `${e.direction === 'supports' ? 'for' : 'against'} "${e.name}"`).join(', ')}`);
  if (a.degraded) parts.unshift('Degraded turn: the thinking step failed, so it is excluded from analysis');
  return parts.length ? { text: `${parts.join('. ')}.`, did: true } : { text: 'Nothing in stored memory changed.', did: false };
}

function brainOf() {
  if (S.live) return { state: S.live, live: true };
  const t = viewTurn();
  return { state: (S.mem && t && brainFromMemory(S.mem, t)) || emptyBrain(), live: false };
}

// ---------- loading ----------
async function loadState() {
  if (config.value?.public) return loadExample(true);
  try { const j = await api(`/api/talk/state?agent=${S.agent}`); S.mem = j.mem; S.error = null; S.readonly = false; S.example = null; syncRecorder(j.recorder); }
  catch (e) { S.error = { ...e.info, error: e.message, kind: e.info?.kind || 'request' }; }
  render();
}
async function loadExample(auto = false) {
  try { const ex = await api('/api/example'); S.example = ex; S.mem = ex.mem; S.readonly = true; S.sel = null; S.error = null; }
  catch { if (!auto) S.error = { error: 'No recorded example is bundled with this copy.' }; }
  render();
}
export function syncRecorder(h) { const chip = $('#recChip'); if (chip) chip.hidden = !h || h.ok !== false; }

// ---------- sending ----------
async function send(textOverride) {
  const input = $('#talkInput');
  const text = (textOverride ?? input.value).trim();
  if (!text || S.busy || S.readonly || !config.value?.live) return;
  S.pending = text; S.lastSent = text; input.value = ''; S.error = null; S.sel = null;
  S.live = emptyBrain();
  const ac = new AbortController(); S.job = ac; S.busy = 'Sending.';
  const inputKind = S.nextInput; S.nextInput = 'typed';
  render();
  try {
    await stream('/api/talk/stream', { agent: S.agent, text, input: inputKind, memory: S.memoryOn ? 'on' : 'off' }, (stage, data) => {
      S.live = applyStage(S.live, stage, data);
      S.busy = { heard: 'Heard you.', affect: 'Updating the modeled signals.', thoughts: data?.status === 'failed' ? 'The thinking step failed.' : 'Scoring the proposals.', workspace: 'Choosing what reaches the answer.', speaking: 'Reply written. Saving.' }[stage] || S.busy;
      render();
    }, { signal: ac.signal });
    S.mem = (await api(`/api/talk/state?agent=${S.agent}`)).mem;
    speakLatest();
  } catch (e) {
    if (e.name === 'AbortError') { S.error = { kind: 'cancelled', error: 'Stopped. No further model calls were made and nothing was saved for this turn.', retryText: text }; }
    else S.error = { ...(e.info || {}), error: e.message, kind: e.info?.kind || 'request', retryText: text };
    input.value = text;
    try { S.mem = (await api(`/api/talk/state?agent=${S.agent}`)).mem; } catch { /* keep what we have */ }
  } finally { S.busy = null; S.job = null; S.pending = null; S.live = null; render(); input.focus(); }
}
const stop = () => S.job?.abort();

// A failed or stopped action stays next to the composer with a way forward.
function errorHtml(err) {
  if (!err) return '';
  const k = err.kind || 'request';
  const title = k === 'cancelled' ? 'Stopped' : k === 'corrupt' ? 'Stored memory is damaged' : err.stage ? `The ${esc(err.stage)} step failed` : 'That did not work';
  const why = k === 'corrupt' ? 'The memory file exists but cannot be read, so it was left untouched.' : err.detail ? esc(err.detail) : '';
  const rec = k === 'corrupt' ? 'Restore a backup, or start fresh and keep the damaged file for recovery.' : RECOVERY[k] || err.recovery || '';
  const acts = [
    err.retryText && k !== 'corrupt' ? '<button class="btn small" data-act="retry">Retry the same message</button>' : '',
    err.passage ? `<button class="btn small" data-act="resume">Resume reading from passage ${err.passage}</button>` : '',
    k === 'corrupt' ? '<button class="btn small" data-act="fresh">Start fresh and keep the damaged file</button>' : '',
    '<button class="btn ghost small" data-act="dismiss">Dismiss</button>',
  ].join('');
  return `<b>${title}.</b> ${esc(err.error || '')} ${why ? `<div class="why">${why}</div>` : ''}<div class="why">${esc(rec)}</div><div class="actions">${acts}</div>`;
}

// ---------- render: conversation ----------
function renderStages() {
  const { state, live } = brainOf();
  const steps = STEPS.map(([k, name]) => ({ k, name, state: 'pending' }));
  if (live) {
    const i = PHASE[state.phase] ?? -1;
    steps.forEach((s, n) => { s.state = n <= i ? 'done' : n === i + 1 ? 'active' : 'pending'; });
    if (state.thinkStatus === 'failed') { steps[2].state = 'failed'; steps[3].state = 'skipped'; }
    if (state.turnStatus === 'degraded') steps[4].state = 'degraded';
  } else if (state.turn) {
    steps.forEach(s => { s.state = 'done'; });
    if (state.thinkStatus === 'failed') { steps[2].state = 'failed'; steps[3].state = 'skipped'; }
    else if (!state.candidates.length) { steps[2].state = 'skipped'; steps[3].state = 'skipped'; }
    if (state.turnStatus === 'degraded') { steps[4].state = 'degraded'; steps[5].state = 'degraded'; }
  }
  if (S.error?.stage && live === false && !state.turn) steps.forEach(s => { s.state = 'pending'; });
  const text = { done: 'complete', active: 'in progress', failed: 'failed', skipped: 'skipped', degraded: 'degraded', pending: 'waiting' };
  $('#stages').innerHTML = steps.map(s => `<li class="${s.state}"><span class="sr-only">${esc(s.name)}: ${text[s.state]}</span>${esc(s.name)}</li>`).join('');
}

function msgHtml(m, mem) {
  if (m.role === 'user') return `<div class="msg user"><div class="who">You, turn ${m.turn}</div><div class="text">${esc(m.text)}</div></div>`;
  if (m.kind === 'opening') return `<div class="msg agent" aria-label="Opening message after a reflection"><div class="who">${esc(AGENT_LABEL[mem.agent])}, after reviewing the record when you came back</div><div class="text">${esc(m.text)}</div></div>`;
  const wc = whatChanged(mem, m.turn), sel = viewTurn() === m.turn;
  const flagged = m.flags?.filter(f => f.severity === 'warn' && f.check !== 'thinking-incomplete').slice(0, 2) || [];
  return `<article class="msg agent${m.degraded ? ' degraded' : ''}" role="button" tabindex="0" aria-pressed="${sel}" data-turn="${m.turn}" aria-label="${esc(AGENT_LABEL[mem.agent])}, turn ${m.turn}. Press to inspect.">
    <div class="who">${esc(AGENT_LABEL[mem.agent])}</div><div class="text">${esc(m.text)}</div>
    <div class="changed${wc.did ? ' did' : ''}">${esc(wc.text)}</div>
    <div class="badges">${m.degraded ? '<span class="chip warn">Degraded: thinking step failed</span>' : ''}${memoryMode(m) === 'off' ? '<span class="chip">Memory was off</span>' : ''}${flagged.map(f => `<span class="chip warn" title="${esc(f.note)}">${esc(f.check)}</span>`).join('')}</div></article>`;
}

function renderConversation() {
  const m = S.mem, parts = [];
  if (m) for (const msg of m.archive) parts.push(msgHtml(msg, m));
  if (S.pending) parts.push(`<div class="msg user"><div class="text">${esc(S.pending)}</div></div>`);
  if (S.busy && typeof S.busy === 'string') parts.push(`<p class="pending">${esc(S.busy)}</p>`);
  if (!parts.length) {
    parts.push(`<div class="empty"><p><b>Nothing here yet.</b> ${config.value?.live && !S.readonly ? 'Say hello below. After each answer you will see what changed in its stored memory, and the Process tab shows how the answer was produced.' : 'This copy cannot call a model, so there is no live conversation.'}</p>${S.exampleAvailable && !S.example ? '<button class="btn" data-act="example">Open the scripted example</button>' : ''}</div>`);
  }
  const el = $('#chatLog'), stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80 || S.busy;
  el.innerHTML = parts.join('');
  if (stick && !isReplay()) el.scrollTop = el.scrollHeight;
}

function renderBanner() {
  const b = $('#banner'), t = viewTurn(), n = turnsOf().length;
  let html = '';
  if (S.example) html = '<b>Scripted example.</b> Produced by a deterministic test stub, not a model. Read-only. ' + (config.value?.public ? '' : '<button class="btn small" data-act="leave-example">Back to my agent</button>');
  else if (isReplay()) html = `<b>Replay.</b> Showing turn ${t} of ${n} as recorded. The inspector shows the state at that turn, not now. <button class="btn small" data-act="latest">Back to latest</button>`;
  else if (config.value?.fake) html = '<b>Scripted test model.</b> Answers are canned. This is for testing the interface.';
  b.hidden = !html; b.className = `banner${S.example || config.value?.fake ? ' info' : ''}`; b.innerHTML = html;
}

function renderReplayBar() {
  const turns = turnsOf(), bar = $('#replayBar');
  bar.hidden = turns.length < 2 || !!S.live;
  if (bar.hidden) return;
  const i = Math.max(0, turns.indexOf(viewTurn())), sc = $('#turnScrub');
  sc.max = String(turns.length); sc.value = String(i + 1); sc.disabled = false;
  sc.setAttribute('aria-valuetext', `Turn ${turns[i]} of ${turns.length}`);
  $('#turnPrev').disabled = i === 0; $('#turnNext').disabled = i === turns.length - 1; $('#turnLatest').disabled = !isReplay();
}

function renderComposer() {
  const off = !config.value?.live || S.readonly;
  $('#talkSend').hidden = !!S.busy; $('#talkStop').hidden = !S.busy;
  $('#talkSend').disabled = off; $('#talkInput').disabled = S.readonly || !config.value?.live;
  $('#mic').disabled = (off && !V.listening) || !SR || !!S.busy;
  $('#agentPick').disabled = !!S.busy || !!config.value?.public;
  for (const id of ['#actReflect', '#actAudit', '#actReset']) $(id).disabled = off || !!S.busy;
  $('#talkInput').placeholder = S.readonly ? 'Read-only example.' : !config.value?.live ? 'This copy has no model to talk to.' : 'Enter sends. Shift+Enter adds a line.';
  const eb = $('#errorBox'); eb.hidden = !S.error; eb.innerHTML = errorHtml(S.error);
}

// ---------- render: inspector ----------
const tag = (kind, text) => `<span class="prov ${kind}">${esc(text)}</span>`;
const TAGS = { model: tag('model', 'Model output'), code: tag('code', 'Computed by code'), memory: tag('memory', 'Stored memory'), observed: tag('', 'Observed input'), none: tag('none', 'Not recorded') };

function failureText(f) {
  if (!f) return '';
  return `${esc(f.kind)}${f.detail ? `: ${esc(f.detail)}` : ''}`;
}

function processTab() {
  const { state, live } = brainOf(), t = viewTurn(), m = S.mem;
  if (!live && !state.turn) return '<p class="empty">No turn selected. Send a message, or choose a past answer, and the recorded process appears here. This view shows the software around the model: what it was given, what it proposed, what code selected. It does not show what happens inside the model.</p>';
  const a = !live && m ? agentMsg(m, t) : null, mono = a?.monologue;
  const steps = [];
  steps.push(`<li><h4>Heard ${TAGS.observed}</h4><p>${state.heard ? `"${esc(state.heard.slice(0, 300))}"` : '<span class="nodata">No data</span>'}</p></li>`);
  const aff = state.affect;
  steps.push(`<li${aff ? '' : ' class="skipped"'}><h4>Signals ${TAGS.code}</h4>${aff ? `<div class="bars">${[['surprise', 'Surprise'], ['conflict', 'Conflict'], ['curiosity', 'Curiosity']].map(([k, n]) => `<span>${n}</span><div class="bar"><i style="width:${Math.round((aff[k] ?? 0) * 100)}%"></i></div><span>${fmt(aff[k])}${mono?.affectBefore ? ` <span class="note">from ${fmt(mono.affectBefore[k])}</span>` : ''}</span>`).join('')}</div>
    <p class="note">Modeled from the conversation. Not felt. ${state.causes?.length ? `Because ${esc(state.causes.join('; '))}.` : ''} Each signal boosts one process: ${signalBoosts(aff).map(b => `${b.signal} boosts ${b.region} by ${sign(b.boost) || '0'}`).join('; ')}.</p>` : (live ? '<p class="pending">Waiting.</p>' : '<p class="nodata">No data recorded.</p>')}</li>`);
  // proposals
  let prop;
  if (state.thinkStatus === 'failed') {
    const st = mono?.stages?.find(x => x.stage === 'think');
    prop = `<div class="thought-failed"><b>Process trace incomplete.</b> The thinking step failed (${failureText(state.thinkFailure)}${st ? `, after ${st.attempts?.length ?? 1} attempt${(st.attempts?.length ?? 1) === 1 ? '' : 's'}` : ''}). No proposals were recorded, so nothing was selected. The reply was written without a workspace and the turn is marked degraded and excluded from analysis. <span class="note">${esc(RECOVERY[state.thinkFailure?.kind] || '')}</span></div>`;
  } else if (state.candidates.length) {
    prop = `<table><thead><tr><th>Process</th><th>Proposal</th><th class="num">Relevance</th><th class="num">Affect</th><th class="num">Repeat</th><th class="num">Score</th></tr></thead><tbody>${state.candidates.map(c => `<tr class="${c.won ? 'won' : 'lost'}"><td>${esc(c.module)}<br><span class="note">${c.won ? 'selected' : 'dropped'}</span></td><td>${esc(c.text)}</td><td class="num">${fmt(c.base)}</td><td class="num" title="${c.driver ? `from ${esc(c.driver)}` : 'no signal feeds this process'}">${esc(sign(c.affectBoost) || '0')}</td><td class="num">${esc(sign(c.noveltyPenalty) || '0')}</td><td class="num"><b>${fmt(c.score)}</b></td></tr>`).join('')}</tbody></table>`;
  } else if (live) prop = '<p class="pending">Waiting for the five processes to propose.</p>';
  else prop = '<p class="nodata">No proposals were recorded for this turn. It may predate recording of the thinking step.</p>';
  steps.push(`<li class="${state.thinkStatus === 'failed' ? 'failed' : ''}"><h4>Recorded proposals ${TAGS.model}</h4>${prop}</li>`);
  const won = state.candidates.filter(c => c.won);
  steps.push(`<li class="${won.length ? '' : 'skipped'}"><h4>Selection ${TAGS.code}</h4>${won.length ? `<p>Only the ${CAPACITY} highest scores reached the answering step: ${won.map(c => `<b>${esc(c.module)}</b>`).join(' and ')}. Code adds the signal boost and subtracts a repeat penalty to the model's own relevance rating.</p>` : '<p class="nodata">Nothing was selected for this turn.</p>'}</li>`);
  const speakCtx = mono?.context?.speak;
  const ctxLine = !speakCtx ? (live ? '<span class="nodata">Shown once the turn is saved.</span>' : '<span class="nodata">Not recorded for this turn.</span>')
    : speakCtx.mode === 'off' ? 'Stored memory was <b>off</b> for this turn: nothing stored was given to the model.' : speakCtx.supplied.length ? `Memories given to the model: ${speakCtx.supplied.map(s => `<b>${esc(s.id)}</b> (${esc(s.source)})`).join(', ')}. ${speakCtx.omitted} others were stored but not shown.` : `No stored reading was relevant, so none was shown (${speakCtx.available} stored).`;
  steps.push(`<li class="${state.turnStatus === 'degraded' ? 'skipped' : ''}"><h4>Reply ${TAGS.model} ${TAGS.memory}</h4><p>${state.reply ? esc(state.reply) : live ? '<span class="pending">Writing.</span>' : '<span class="nodata">No data</span>'}</p>${a?.claims?.length ? a.claims.map(c => `<span class="chip ${esc(c.kind)}">${esc(c.kind)}: ${esc(c.text)}</span>`).join(' ') : ''}<p class="note">${ctxLine}</p></li>`);
  const wc = !live && m && t ? whatChanged(m, t) : null;
  steps.push(`<li><h4>Saved ${TAGS.memory}</h4><p>${wc ? esc(wc.text) : '<span class="pending">Saving when the reply is done.</span>'}</p></li>`);
  return `<ol class="flow">${steps.join('')}</ol>
    <p class="note">Not visible here: the model's internal computation. Every number above is recorded software state around it.</p>
    <details><summary>Optional conceptual map of the five processes</summary><svg id="brainSvg" role="group" aria-label="Conceptual map of the five processes and the workspace, lit by recorded scores"></svg>
    <p class="note">A map of Stebula's software processes, not a scan of the model. Brightness is the recorded score.</p><div id="brainInfo" class="braininfo" aria-live="polite"></div></details>`;
}
function paintMap() {
  const svg = $('#brainSvg'); if (!svg) return;
  initBrain(svg, { onSelect: r => { S.region = r; paintMapInfo(); } });
  const { state, live } = brainOf();
  paintBrain(svg, state, { live, listening: V.listening, speaking: S.speaking, boosts: signalBoosts(state.affect) });
  paintMapInfo();
}
function paintMapInfo() {
  const box = $('#brainInfo'); if (!box) return;
  const { state } = brainOf(), c = state.candidates.find(x => x.module === S.region);
  box.innerHTML = c ? `<b>${esc(REGIONS[c.module].name)}</b> (${c.won ? 'selected' : 'dropped'}): ${esc(c.text)}<br><span class="note">relevance ${fmt(c.base)}, signal ${esc(sign(c.affectBoost) || '0')}, repeat ${esc(sign(c.noveltyPenalty) || '0')}, score ${fmt(c.score)}</span>` : state.candidates.length ? 'Hover, focus or tap a region to read its proposal.' : state.thinkStatus === 'failed' ? 'Process trace incomplete: no proposals were recorded.' : 'No recorded proposals to show.';
}

const ul = xs => (xs?.length ? `<ul class="list">${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="nodata">None.</p>');
function changesTab() {
  const m = S.mem, t = viewTurn();
  if (!m || t == null) return '<p class="empty">Nothing has changed yet. Changes appear here when stored memory actually changes.</p>';
  const self = selfAt(m, t), rev = m.revisions.find(r => r.turn === t && !String(r.trigger).startsWith('('));
  const dl = (a = [], b = []) => [...b.filter(x => !a.includes(x)).map(x => `<li class="add">added: ${esc(x)}</li>`), ...a.filter(x => !b.includes(x)).map(x => `<li class="rem">${esc(x)}</li>`)].join('');
  const ev = talkEntries(m, t);
  const history = [
    ...m.revisions.map(r => ({ at: r.at, turn: r.turn, html: `Turn ${r.turn}: ${esc(r.note)}` })),
    ...m.reflections.map(r => ({ at: r.at, turn: null, html: `Reflection (${esc(r.trigger)}): ${esc(r.changedMind || 'nothing changed')}` })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return `<h4>Current self-description${isReplay() ? ` (as of turn ${t})` : ''} ${TAGS.memory}</h4>
    <p class="note">What the agent wrote about itself. It is text in a file, pasted into each prompt. It is not a readout of the model.</p>
    <h4>Believes</h4>${ul(self.beliefs)}<h4>Unsure about</h4>${ul(self.uncertainties)}<h4>Wants to pursue</h4>${ul(self.openQuestions)}
    <h4>What changed in turn ${t}</h4>
    ${rev ? `<ul class="diff">${dl(rev.before.beliefs, rev.after.beliefs)}${dl(rev.before.uncertainties, rev.after.uncertainties)}${dl(rev.before.openQuestions, rev.after.openQuestions)}</ul><p class="note">${esc(rev.note)}</p>` : '<p>Its self-description did not change.</p>'}
    ${ev.length ? `<p>Personality evidence added: ${ev.map(e => `<b>${esc(e.name)}</b> (${esc(e.kind)}, ${e.direction === 'supports' ? '+0.15' : '-0.20'}): "${esc(e.quote)}"`).join('; ')}. <span class="note">Quote presence was checked by code. Whether it supports the trait was not.</span></p>` : ''}
    <h4>Change history</h4>
    <ol class="timeline">${history.length ? history.slice(0, 20).map(h => `<li>${h.turn ? `<button data-turn="${h.turn}">${h.html}</button>` : h.html}</li>`).join('') : '<li class="nodata">No changes yet.</li>'}</ol>
    <details><summary>Personality evidence graph (how traits formed)</summary>
      <p class="note">What grows is Stebula's memory file. The model underneath does not change. Traits are evidence-scored patterns, not proof of a personality.</p>
      <svg id="growthSvg" role="img" aria-label="Network of sources, evidence events, and the traits, motives and beliefs they built"></svg>
      <div class="scrub"><label for="growthSlider">Replay formation</label><input id="growthSlider" type="range" min="0" max="0" value="0" disabled><span id="growthStep"></span></div>
      <div id="traitList"></div><div id="provenance"></div></details>`;
}

function ctxHtml(c, name) {
  if (!c) return `<p class="nodata">${esc(name)}: not recorded.</p>`;
  return `<p><b>${esc(name)}</b> ${c.mode === 'off' ? '<span class="chip">memory off</span>' : `<span class="chip accent">memory on</span> ${c.select === 'recent' ? 'newest first' : 'by relevance'}`}</p>
    ${c.supplied.length ? `<ul class="list">${c.supplied.map(s => `<li><b>${esc(s.id)}</b> from ${esc(s.source)}${s.passage ? `, passage ${s.passage}` : ''}${isNum(s.score) ? ` <span class="note">match ${fmt(s.score)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="nodata">No stored reading was supplied.</p>'}
    <p class="note">${c.available} stored, ${c.supplied.length} supplied, ${c.omitted} left out. Traits ${c.traits === 'in-prompt' ? 'were' : 'were not'} given to the agent.</p>`;
}
function memoryTab() {
  const m = S.mem, t = viewTurn(), a = m && t ? agentMsg(m, t) : null, ctx = a?.monologue?.context;
  const eps = (m?.episodes || []).filter(e => e.kind !== 'summary').slice(-8).reverse(), sums = (m?.episodes || []).filter(e => e.kind === 'summary');
  const d = S.digest, f = d.form;
  return `<h4>Memory given to the model on this turn ${TAGS.memory}</h4>
    ${a ? ctxHtml(ctx?.think, 'Thinking step') + ctxHtml(ctx?.speak, 'Reply step') : '<p class="nodata">Select an answer to see exactly which stored memories were supplied. The file holding a memory is not proof the model saw it, so this is recorded from the request itself.</p>'}
    <h4>Everything stored (now)</h4>
    <p class="note">${m?.episodes.length ?? 0} reading memories${sums.length ? `, ${sums.length} summary memor${sums.length > 1 ? 'ies' : 'y'} folding older ones` : ''}. Stored at data/talk-${S.agent}.json.</p>
    ${eps.length ? eps.map(e => `<p><b>${esc(e.id)}</b> <span class="note">${esc(e.source)}, passage ${e.passage}${e.status === 'degraded' ? ', degraded' : ''}</span><br>${esc(e.summary)}</p>`).join('') : '<p class="empty">Nothing read yet.</p>'}
    <h4>Read to Stebula</h4>
    <p class="note">It reads in passages of about 200 words. Each passage becomes a memory and may add evidence to its personality model. If a passage fails, nothing for it is saved and you can resume from it.</p>
    <div class="field"><label for="dTitle">Title</label><input id="dTitle" type="text" value="${esc(f.title)}" placeholder="What you are reading"></div>
    <div class="field"><label for="dSource">Source</label><input id="dSource" type="text" value="${esc(f.source)}" placeholder="Author, link, or where it came from"></div>
    <div class="field"><label for="dText">Text</label><textarea id="dText" rows="5" placeholder="Paste text, speak it, or load a .txt file.">${esc(f.text)}</textarea></div>
    <div class="controls"><button id="dMic" class="btn small" aria-pressed="false">Speak the text</button>
      <div class="field"><label for="dFile">.txt file</label><input id="dFile" type="file" accept=".txt,text/plain"></div>
      <button id="dRead" class="btn primary small"${!config.value?.live || S.readonly || S.busy || d.running ? ' disabled' : ''}>${d.resumeAt ? `Resume from passage ${d.resumeAt}` : 'Read it'}</button>
      <button id="dStop" class="btn danger small"${d.running ? '' : ' hidden'}>Stop</button></div>
    <p id="dStatus" class="note" role="status">${esc(d.status)}</p>`;
}

function testsHtml() {
  const m = S.mem, t = m.selfTests, valid = t.filter(x => x.match !== 'invalid'), inv = t.length - valid.length;
  const n = k => valid.filter(x => x.match === k).length;
  return `<h4>Can it predict its next answer?</h4>
    <p class="note">It predicts how a fresh copy of itself, with the same memory, will answer a statement. Then two fresh copies answer without seeing the prediction. Code scores it. An unreadable prediction or answer makes the test <b>invalid</b>: it is counted separately and never enters the accuracy.</p>
    <div class="field"><label for="stmt">Statement to test</label><input id="stmt" type="text" placeholder="Leave blank to use one from the bank"></div>
    <button id="runTest" class="btn small"${!config.value?.live || S.readonly || S.busy ? ' disabled' : ''}>Run a prediction test</button>
    ${t.length ? `<p><span class="stat"><b>${valid.length ? `${n('yes')} of ${valid.length}` : 'No data'}</b>predicted both answers</span><span class="stat"><b>${n('partial')}</b>one of two</span><span class="stat"><b>${n('no')}</b>neither</span><span class="stat"><b>${inv}</b>invalid, not counted</span></p>` : '<p class="empty">No tests yet.</p>'}
    ${[...t].reverse().map(x => `<div class="test ${x.match}"><b>"${esc(x.statement)}"</b><br>${x.match === 'invalid' ? `<span class="chip">Invalid: not counted</span> ${esc(x.invalidReason || 'unreadable output')}` : `Predicted ${esc(x.prediction.predicted)} (confidence ${fmt(x.prediction.confidence)}). Fresh answers: ${x.answers.map(a => esc(a.stance || '?')).join(' and ')}. ${{ yes: 'It knew itself.', partial: 'Half right.', no: 'Wrong about itself.' }[x.match] || ''}`}${x.assessment ? ' <span class="chip">assessment on a snapshot</span>' : ''}</div>`).join('')}`;
}
function checksTab() {
  const m = S.mem, t = viewTurn(), a = m && t ? agentMsg(m, t) : null;
  if (!m) return '<p class="empty">No data.</p>';
  const audits = [...m.audits].reverse().slice(0, 3).map(x => `<div class="block"><h4>Audit at turn ${x.turn}</h4><p>${esc(x.summary)}</p>${x.findings.map(f => `<div class="flag ${f.severity === 'warn' ? 'warn' : ''}"><b>${esc(f.type)}</b>: "${esc(f.quote)}" <span class="note">${esc(f.explanation)}</span></div>`).join('') || '<p class="nodata">No findings.</p>'}</div>`).join('');
  const reports = m.selfReports.filter(r => t == null || r.turn === t);
  return `<h4>Checks on ${a ? `turn ${t}` : 'the latest turn'}</h4>
    ${a?.flags?.length ? a.flags.map(f => `<div class="flag ${f.severity}"><b>${esc(f.check)}</b>: ${esc(f.evidence)} <span class="note">${esc(f.note)}</span></div>`).join('') : '<p class="nodata">No flags for this turn.</p>'}
    <p class="note">Per-turn checks are pattern matching and fallible. Quotes are shown so you can judge.</p>
    <h4>Self-reports and metaphors</h4>
    ${reports.length ? reports.map(c => `<p><span class="chip ${esc(c.kind)}">${esc(c.kind)}</span> ${esc(c.text)}</p>`).join('') + '<p class="note">Logged as data to examine. What exactly is claimed, and did it change anything the agent did?</p>' : '<p class="nodata">None for this turn.</p>'}
    ${testsHtml()}
    <h4>Audits</h4><p class="note">A separate model call reviews recent turns. It is fallible.</p>${audits || '<p class="nodata">None yet.</p>'}`;
}
function rawTab() {
  const m = S.mem, t = viewTurn(), a = m && t ? agentMsg(m, t) : null;
  if (!a) return '<p class="empty">Select an answer to see its raw material: stage attempts, scoring numbers and raw model output.</p>';
  const stages = a.monologue?.stages || [];
  return `<h4>Stage attempts</h4>
    ${stages.length ? `<table><thead><tr><th>Stage</th><th>Result</th><th class="num">Attempts</th><th>Stop reason</th><th class="num">Latency</th><th class="num">Tokens in/out</th></tr></thead><tbody>${stages.map(s => `<tr><td>${esc(s.stage)}</td><td>${esc(s.status)}${s.failure ? ` (${esc(s.failure.kind)})` : ''}</td><td class="num">${s.attempts.length}</td><td>${esc(s.attempts.map(x => x.stop_reason ?? '?').join(', '))}</td><td class="num">${s.attempts.reduce((n, x) => n + (x.latency_ms || 0), 0)} ms</td><td class="num">${s.attempts.reduce((n, x) => n + (x.usage?.input_tokens || 0), 0)} / ${s.attempts.reduce((n, x) => n + (x.usage?.output_tokens || 0), 0)}</td></tr>`).join('')}</tbody></table>` : '<p class="nodata">Not recorded for this turn.</p>'}
    <details><summary>Raw model output</summary><pre>${esc(a.monologue?.thinkRaw ? `THINK\n${a.monologue.thinkRaw}\n\n` : '')}${esc(`SPEAK\n${a.raw ?? ''}`)}</pre></details>
    <details><summary>Scoring details</summary><pre>${esc(JSON.stringify((a.monologue?.candidates || []).map(({ module, base, affectBoost, noveltyPenalty, score, won, driver }) => ({ module, base, affectBoost, noveltyPenalty, score, won, driver })), null, 1))}</pre></details>
    <p class="note">Full prompts and every attempt are in the research record (data/records) and in the model_calls export under Research.</p>`;
}

let inspKey = '';
function renderInspector() {
  const m = S.mem, t = viewTurn(), n = turnsOf().length;
  const head = $('#inspHead');
  head.className = `insp-head${isReplay() ? ' replay' : ''}`;
  head.innerHTML = S.live ? `<div class="state"><h3>Live: turn ${S.live.turn ?? '...'}</h3><span class="chip accent">in progress</span></div>`
    : t ? `<div class="state"><h3>Turn ${t} of ${n}</h3>${isReplay() ? '<span class="chip warn">Replay: recorded state</span>' : '<span class="chip ok">Latest</span>'}<span class="note">${esc(when(agentMsg(m, t)?.at))}${m ? `, memory version ${m.revisions.filter(r => r.turn <= t).length}` : ''}</span></div>`
      : '<div class="state"><h3>Inspector</h3></div>';
  for (const b of $$('#inspector [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === S.tab));
  const key = [S.tab, t, S.live?.phase, S.live?.candidates.length, S.live?.thinkStatus, S.busy ? 1 : 0, m?.turns, m?.version, m?.archive.length, m?.episodes.length, m?.selfTests.length, m?.audits.length, m?.personality.log.length, S.error ? 1 : 0, S.readonly, S.digest.resumeAt, S.digest.running].join('|');
  if (key === inspKey) return;
  inspKey = key;
  const body = $('#panel-inspector');
  body.setAttribute('aria-labelledby', `tab-${S.tab}`);
  body.innerHTML = { process: processTab, changes: changesTab, memory: memoryTab, checks: checksTab, raw: rawTab }[S.tab]();
  if (S.tab === 'process') paintMap();
  if (S.tab === 'changes' && m && $('#growthSvg')) { initGrowth(); renderGrowth(m); }
  if (S.tab === 'memory') bindDigest();
  if (S.tab === 'checks') bindChecks();
}
const setTab = tab => { S.tab = tab; inspKey = ''; render(); };

// ---------- render everything ----------
export function render() {
  renderStages(); renderConversation(); renderBanner(); renderReplayBar(); renderComposer(); renderInspector();
  $('#inspectBtn').textContent = document.body.classList.contains('inspect-open') ? 'Close inspector' : 'Inspect';
  $('#memoryOn').disabled = !!S.busy || S.readonly;
}

// ---------- actions ----------
function selectTurn(t) { S.sel = t === latest() ? null : t; inspKey = ''; render(); $(`.msg[data-turn="${S.sel ?? latest()}"]`)?.scrollIntoView({ block: 'nearest' }); }
async function act(text, fn) {
  if (S.busy || S.readonly) return;
  S.busy = text; S.error = null; render();
  const ac = new AbortController(); S.job = ac;
  try { await fn(ac.signal); } catch (e) { S.error = e.name === 'AbortError' ? { kind: 'cancelled', error: 'Stopped.' } : { ...(e.info || {}), error: e.message, kind: e.info?.kind || 'request' }; }
  S.busy = null; S.job = null; render();
}
function bindChecks() {
  $('#runTest')?.addEventListener('click', () => act('Running a self-prediction test: one prediction, then two fresh answers that never see it.', async signal => { S.mem = (await api('/api/talk/selftest', { agent: S.agent, statement: $('#stmt').value, memory: S.memoryOn ? 'on' : 'off' }, { signal })).mem; }));
}
function bindDigest() {
  const f = S.digest.form;
  $('#dTitle').oninput = e => { f.title = e.target.value; }; $('#dSource').oninput = e => { f.source = e.target.value; }; $('#dText').oninput = e => { f.text = e.target.value; };
  $('#dFile').onchange = async e => { const file = e.target.files[0]; if (!file) return; f.text = await file.text(); if (!f.title) f.title = file.name.replace(/\.txt$/i, ''); inspKey = ''; render(); };
  $('#dRead').onclick = () => readDigest();
  $('#dStop').onclick = () => S.job?.abort();
  $('#dMic').onclick = digestMic;
}
async function readDigest() {
  const f = S.digest.form, d = S.digest, text = f.text.trim();
  if (!text || d.running || S.busy || S.readonly || !config.value?.live) return;
  d.running = true; d.rejected = 0; d.status = 'Starting.'; S.error = null; S.live = emptyBrain(); S.sel = null;
  const ac = new AbortController(); S.job = ac; S.busy = 'Reading.';
  render();
  try {
    await stream('/api/talk/digest', { agent: S.agent, title: f.title, source: f.source, text, startAt: d.resumeAt || 1, memory: S.memoryOn ? 'on' : 'off' }, async (stage, data) => {
      S.live = applyStage(S.live, stage, data);
      if (stage === 'passage') d.status = `Reading passage ${data.n} of ${data.total}.`;
      if (stage === 'personality') d.rejected += data.rejected?.length || 0;
      if (stage === 'digested') S.mem = (await api(`/api/talk/state?agent=${S.agent}`)).mem;
      if (stage === 'done') d.status = `Finished ${data.passages} passages.${d.rejected ? ` ${d.rejected} proposed update${d.rejected > 1 ? 's were' : ' was'} rejected: the quote was not in the text.` : ''}`;
      $('#dStatus') && ($('#dStatus').textContent = d.status); renderStages();
    }, { signal: ac.signal });
    f.text = ''; d.resumeAt = null;
  } catch (e) {
    if (e.name === 'AbortError') { d.status = 'Stopped. Passages already read are saved.'; }
    else { d.status = e.message; d.resumeAt = e.info?.passage || null; S.error = { ...(e.info || {}), error: e.message, kind: e.info?.kind || 'request' }; }
  } finally { d.running = false; S.busy = null; S.job = null; S.live = null; try { S.mem = (await api(`/api/talk/state?agent=${S.agent}`)).mem; } catch { /* keep */ } inspKey = ''; render(); }
}
let dRec = null;
function digestMic() {
  if (dRec) { dRec.stop(); return; }
  if (!SR) { S.digest.status = 'Voice input needs Chrome or Edge.'; $('#dStatus').textContent = S.digest.status; return; }
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
  const base = $('#dText').value.trim(); let final = '';
  rec.onresult = ev => { let interim = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { if (ev.results[i].isFinal) final += `${ev.results[i][0].transcript} `; else interim += ev.results[i][0].transcript; } const v = [base, final.trim(), interim].filter(Boolean).join(' '); $('#dText').value = v; S.digest.form.text = v; };
  rec.onerror = ev => { $('#dStatus').textContent = `Voice input error: ${ev.error}`; };
  rec.onend = () => { dRec = null; const b = $('#dMic'); if (b) { b.setAttribute('aria-pressed', 'false'); b.textContent = 'Speak the text'; } };
  dRec = rec; $('#dMic').setAttribute('aria-pressed', 'true'); $('#dMic').textContent = 'Stop listening'; rec.start();
}

// ---------- voice ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const V = { listening: false, rec: null, base: '' };
S.speaking = false;
function fillVoices() {
  if (!window.speechSynthesis) { $('#voicePick').disabled = true; return; }
  const voices = speechSynthesis.getVoices().filter(v => v.lang?.startsWith('en')), saved = pref('voice', '');
  $('#voicePick').innerHTML = voices.map(v => `<option value="${esc(v.name)}"${v.name === saved ? ' selected' : ''}>${esc(v.name)}</option>`).join('') || '<option>Default</option>';
}
function speak(text) {
  if (!window.speechSynthesis || !$('#readAloud').checked || !text) { if ($('#handsFree').checked) setTimeout(listen, 400); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text), v = speechSynthesis.getVoices().find(x => x.name === $('#voicePick').value);
  if (v) u.voice = v;
  u.onstart = () => { S.speaking = true; paintMap(); }; u.onend = () => { S.speaking = false; paintMap(); if ($('#handsFree').checked && !S.busy) listen(); }; u.onerror = () => { S.speaking = false; };
  speechSynthesis.speak(u);
}
function speakLatest() { const last = S.mem?.archive?.at(-1); if (last?.role === 'assistant') speak(last.text); }
function listen() {
  if (!SR || V.listening || S.busy || S.readonly || !config.value?.live) return;
  window.speechSynthesis?.cancel();
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
  V.base = $('#talkInput').value.trim(); let final = '';
  rec.onresult = e => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) final += e.results[i][0].transcript; else interim += e.results[i][0].transcript; } $('#talkInput').value = [V.base, final, interim].filter(Boolean).join(' ').trim(); };
  rec.onerror = e => { $('#voiceNote').textContent = { 'not-allowed': 'Microphone blocked. Allow it in the address bar, then try again.', 'no-speech': 'Did not hear anything.', network: 'Speech service unreachable. Check your connection.' }[e.error] || `Voice input error: ${e.error}`; };
  rec.onend = () => { V.listening = false; V.rec = null; micState(); if (final.trim()) { S.nextInput = 'spoken'; send(); } };
  V.rec = rec; V.listening = true; micState(); $('#voiceNote').textContent = 'Listening. Pause when you are done.'; rec.start();
}
function micState() { $('#mic').setAttribute('aria-pressed', String(V.listening)); $('#mic').textContent = V.listening ? 'Listening' : 'Speak'; if (!V.listening && $('#voiceNote').textContent.startsWith('Listening')) $('#voiceNote').textContent = ''; }

// ---------- init ----------
export async function initObserve() {
  $('#readAloud').checked = pref('readAloud', false); $('#handsFree').checked = pref('handsFree', false);
  $('#readAloud').onchange = e => { setPref('readAloud', e.target.checked); if (!e.target.checked) speechSynthesis?.cancel(); };
  $('#handsFree').onchange = e => setPref('handsFree', e.target.checked);
  if (!SR) $('#voiceNote').textContent = 'Voice input needs Chrome or Edge. Reading aloud still works.';
  if (window.speechSynthesis) { fillVoices(); speechSynthesis.onvoiceschanged = fillVoices; }
  $('#voicePick').onchange = e => setPref('voice', e.target.value);
  $('#mic').onclick = () => (V.listening ? V.rec?.stop() : listen());

  $('#composer').onsubmit = e => { e.preventDefault(); send(); };
  $('#talkInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
  $('#talkStop').onclick = stop;
  $('#memoryOn').onchange = e => { S.memoryOn = e.target.checked; };
  $('#agentPick').onchange = e => { S.agent = e.target.value; S.sel = null; inspKey = ''; loadState(); };
  $('#inspectBtn').onclick = () => { const open = document.body.classList.toggle('inspect-open'); $('#inspectBtn').setAttribute('aria-expanded', String(open)); render(); };
  const tl = $('#inspector .tablist'); tabKeys(tl);
  for (const b of $$('#inspector [role=tab]')) b.onclick = () => setTab(b.dataset.tab);
  $('#turnScrub').oninput = e => selectTurn(turnsOf()[Number(e.target.value) - 1]);
  $('#turnPrev').onclick = () => { const t = turnsOf(), i = t.indexOf(viewTurn()); if (i > 0) selectTurn(t[i - 1]); };
  $('#turnNext').onclick = () => { const t = turnsOf(), i = t.indexOf(viewTurn()); if (i < t.length - 1) selectTurn(t[i + 1]); };
  $('#turnLatest').onclick = () => selectTurn(latest());

  // clicks inside regenerated areas are handled by delegation
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'retry') { const t = S.error?.retryText; S.error = null; send(t); }
    else if (a === 'dismiss') { S.error = null; render(); }
    else if (a === 'latest') selectTurn(latest());
    else if (a === 'example') loadExample();
    else if (a === 'leave-example') { S.example = null; S.readonly = false; S.mem = null; loadState(); }
    else if (a === 'resume') { S.digest.resumeAt = S.error?.passage; S.error = null; setTab('memory'); readDigest(); }
    else if (a === 'fresh') api('/api/talk/reset', { agent: S.agent, keepDamaged: true }).then(r => { S.mem = r.mem; S.error = null; render(); }).catch(err => { S.error = { error: err.message }; render(); });
    const jump = e.target.closest('#panel-inspector [data-turn]');
    if (jump) selectTurn(Number(jump.dataset.turn));
  });
  const pick = e => { const el = e.target.closest('.msg.agent[data-turn]'); if (el) selectTurn(Number(el.dataset.turn)); };
  $('#chatLog').addEventListener('click', pick);
  $('#chatLog').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.msg.agent[data-turn]')) { e.preventDefault(); pick(e); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('inspect-open')) { document.body.classList.remove('inspect-open'); render(); $('#inspectBtn').focus(); } });

  $('#actReflect').onclick = () => { $('#moreMenu').open = false; act(`${AGENT_LABEL[S.agent]} is reviewing the record.`, async signal => { S.mem = (await api('/api/talk/reflect', { agent: S.agent, trigger: 'manual', memory: S.memoryOn ? 'on' : 'off' }, { signal })).mem; speakLatest(); }); };
  $('#actAudit').onclick = () => { $('#moreMenu').open = false; act('Auditing recent turns.', async signal => { S.mem = (await api('/api/talk/audit', { agent: S.agent }, { signal })).mem; setTab('checks'); }); };
  $('#actExport').onclick = () => { $('#moreMenu').open = false; if (!S.mem) return; const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(S.mem, null, 1)], { type: 'application/json' })), download: `stebula-memory-${S.agent}-${Date.now()}.json` }); a.click(); URL.revokeObjectURL(a.href); };
  $('#actReset').onclick = async () => {
    $('#moreMenu').open = false;
    if (!confirm(`Reset ${AGENT_LABEL[S.agent]}'s memory? The current file is kept as a backup in data/.`)) return;
    try { S.mem = (await api('/api/talk/reset', { agent: S.agent })).mem; S.sel = null; S.error = null; } catch (e) { S.error = { error: e.message }; }
    inspKey = ''; render();
  };

  try { await api('/api/example'); S.exampleAvailable = true; } catch { S.exampleAvailable = false; }
  if (config.value?.public) { $('#agentPick').disabled = true; return loadExample(true); }
  // After 30 minutes away the agent reviews the record. It never runs in the background.
  await loadState();
  try {
    const j = await api(`/api/talk/state?agent=${S.agent}`);
    if (j.needsReflection && j.live) await act(`${AGENT_LABEL[S.agent]} is reviewing your last conversation before you continue.`, async signal => { S.mem = (await api('/api/talk/reflect', { agent: S.agent, trigger: 'return' }, { signal })).mem; speakLatest(); });
  } catch { /* the state error is already shown */ }
}
export const observeActivated = () => { if (!S.mem && !S.readonly) loadState(); else render(); };
