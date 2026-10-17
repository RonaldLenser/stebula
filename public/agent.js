// Agent: who you are talking to, what it is doing, the conversation, the process map of one turn, and one inspector.
// Everything shown comes from the turn stream or from the stored memory file. Selecting a message, a stage,
// a line or a memory changes the one shared selection in store.js, so the three panels always show the same turn.
import { $, $$, esc, fmt, pref, setPref, api, stream, config, tabKeys, when } from '/core.js';
import { S, AGENTS, agentName, subscribe, notify, turns, latest, viewTurn, isHistory, selectTurn, selectNode, loadState, loadExample, switchAgent, refreshMem, syncRecorder } from '/store.js';
import { processModel, activityLabel, whatChanged, agentMsg, userMsg, STEPS, STATUS_TEXT } from '/src/talk/process.js';
import { applyStage, emptyBrain } from '/src/talk/brain.js';
import { mapHtml, drawEdges, hookResize } from '/map.js';
import { inspectorHtml, statusChip } from '/inspector.js';

const memoryMode = m => m?.monologue?.context?.speak?.mode ?? 'on';
const RECOVERY = { refusal: 'Reword the message and send it again. The provider declined this request.', truncation: 'The reply was cut off. Try a shorter message, or retry.', malformed: 'The model returned something unreadable twice. Retry.', schema: 'The model returned the wrong shape of answer twice. Retry.', empty: 'The model returned no text. Retry.', transport: 'The model service did not answer. Check your connection and retry.', timeout: 'The model took too long. Retry.' };
const STAGE_NAME = { think: 'thinking', speak: 'reply', 'digest-read': 'reading', 'digest-think': 'thinking', reflect: 'reflection', audit: 'audit' };
const model = () => processModel({ mem: S.mem, turn: viewTurn(), live: S.live, agent: S.agent });

// ---------- summary: who, doing what, about what, latest ----------
function renderSummary() {
  const ag = AGENTS[S.agent] ?? { name: `Agent ${S.agent}`, role: '', about: '' };
  const m = S.mem, t = viewTurn(), n = turns().length;
  $('#sumName').textContent = agentName(S.agent);
  $('#sumAbout').textContent = ag.about;
  $('#agentBadge').textContent = S.agent; $('#agentBadge').dataset.agent = S.agent;
  const label = activityLabel({ live: S.live, busy: typeof S.busy === 'string' ? S.busy : null, readonly: S.readonly, hasModel: !!config.value?.live });
  const working = !!S.live || !!S.busy;
  $('#sumStatus').innerHTML = `<span class="dot${working ? ' on' : ''}" aria-hidden="true"></span>${esc(label)}`;
  const focusText = S.pending ?? (t != null ? userMsg(m, t)?.text : null);
  $('#sumFocus').textContent = focusText ? `"${focusText.length > 90 ? `${focusText.slice(0, 90)}...` : focusText}"` : 'Nothing yet';
  const last = latest();
  const lm = last != null ? agentMsg(m, last) : null;
  $('#sumLatest').textContent = lm ? `Turn ${last}, ${when(lm.at)}. ${whatChanged(m, last).text}` : 'No turns yet';
  const ver = m ? `version ${m.version}, ${m.turns} turn${m.turns === 1 ? '' : 's'}, ${m.episodes.length} reading${m.episodes.length === 1 ? '' : 's'} stored` : '';
  $('#sumMemory').textContent = ver || 'Loading';
  $('#agentPick').value = S.agent;
}

function renderBanner() {
  const b = $('#banner'), t = viewTurn(), n = turns().length;
  const parts = []; let cls = '';
  if (S.example) { parts.push('<b>Scripted example.</b> Produced by a deterministic test stub, not a model. Read-only. ' + (config.value?.public ? '' : '<button class="btn small" data-act="leave-example">Back to my agent</button>')); cls = ' info'; }
  if (isHistory()) { parts.push(`<b>Viewing history.</b> Turn ${t} of ${n}, recorded ${esc(when(agentMsg(S.mem, t)?.at))}. The conversation, map and inspector show the state recorded then, not the latest. <button class="btn small" data-act="latest">Back to latest</button>`); cls = ''; }
  if (!parts.length && config.value?.fake) { parts.push('<b>Scripted test model.</b> Answers are canned. This is for testing the interface.'); cls = ' info'; }
  const html = parts.join('<br>');
  b.hidden = !html; b.className = `banner${cls}`; b.innerHTML = html;
}

// ---------- conversation ----------
function errorHtml(err) {
  if (!err) return '';
  const k = err.kind || 'request';
  const title = k === 'cancelled' ? 'Stopped' : k === 'corrupt' ? 'Stored memory is damaged' : err.stage ? `The ${esc(STAGE_NAME[err.stage] || err.stage)} step failed` : 'That did not work';
  const why = k === 'corrupt' ? 'The memory file exists but cannot be read, so it was left untouched.' : err.detail ? esc(err.detail) : '';
  const headline = k === 'cancelled' || k === 'corrupt' || !err.stage ? err.error || '' : '';
  const rec = k === 'corrupt' ? 'Restore a backup, or start fresh and keep the damaged file for recovery.' : RECOVERY[k] || err.recovery || '';
  const acts = [
    err.retryText && k !== 'corrupt' ? '<button class="btn small" data-act="retry">Retry the same message</button>' : '',
    err.passage ? `<button class="btn small" data-act="resume">Resume reading from passage ${err.passage}</button>` : '',
    k === 'corrupt' ? '<button class="btn small" data-act="fresh">Start fresh and keep the damaged file</button>' : '',
    '<button class="btn ghost small" data-act="dismiss">Dismiss</button>',
  ].join('');
  return `<b>${title}.</b> ${esc(headline)} ${why ? `<div class="why">${why}</div>` : ''}<div class="why">${esc(rec)}</div><div class="actions">${acts}</div>`;
}

function msgHtml(m, mem) {
  const sel = viewTurn() === m.turn;
  if (m.role === 'user') return `<div class="msg user${sel ? ' sel' : ''}" role="button" tabindex="0" data-turn="${m.turn}" data-pick="noticed" aria-pressed="${sel}" aria-label="Your message, turn ${m.turn}. Press to see what it noticed."><div class="who">You, turn ${m.turn}</div><div class="text">${esc(m.text)}</div></div>`;
  if (m.kind === 'opening') return `<div class="msg agent opening" aria-label="Opening message after a reflection"><div class="who">${esc(agentName(mem.agent))}, after reviewing the record when you came back</div><div class="text">${esc(m.text)}</div></div>`;
  const wc = whatChanged(mem, m.turn);
  const flagged = m.flags?.filter(f => f.severity === 'warn' && f.check !== 'thinking-incomplete').slice(0, 2) || [];
  return `<article class="msg agent${m.degraded ? ' degraded' : ''}" role="button" tabindex="0" aria-pressed="${sel}" data-turn="${m.turn}" data-pick="reply" aria-label="${esc(agentName(mem.agent))}, turn ${m.turn}. Press to see how this was made.">
    <div class="who">${esc(agentName(mem.agent))}</div><div class="text">${esc(m.text)}</div>
    <div class="changed${wc.did ? ' did' : ''}">${esc(wc.text)}</div>
    <div class="badges">${m.degraded ? '<span class="chip st-failed">Incomplete: thinking step failed</span>' : ''}${memoryMode(m) === 'off' ? '<span class="chip">Memory was off</span>' : ''}${flagged.map(f => `<span class="chip warn" title="${esc(f.note)}">${esc(f.check)}</span>`).join('')}<span class="hint">${sel ? 'Showing how this was made' : 'See how this was made'}</span></div></article>`;
}
function renderConversation() {
  const m = S.mem, parts = [];
  if (m) for (const msg of m.archive) parts.push(msgHtml(msg, m));
  if (S.pending) parts.push(`<div class="msg user"><div class="text">${esc(S.pending)}</div></div>`);
  if (S.busy && typeof S.busy === 'string' && !S.live) parts.push(`<p class="pending">${esc(S.busy)}</p>`);
  if (S.live) parts.push(`<p class="pending">${esc(activityLabel({ live: S.live }))}.</p>`);
  if (!parts.length) parts.push(`<div class="empty"><p><b>Nothing here yet.</b> ${config.value?.live && !S.readonly ? `Say hello below. After each answer, the map shows how it was made and what changed in ${esc(AGENTS[S.agent]?.name || 'the agent')}'s stored memory.` : 'This copy cannot call a model, so there is no live conversation.'}</p>${S.exampleAvailable && !S.example ? '<button class="btn" data-act="example">Open the scripted example</button>' : ''}</div>`);
  $('#chatLog').innerHTML = parts.join('');
  bottom();
}
function renderTurnBar() {
  const ts = turns(), bar = $('#replayBar');
  bar.hidden = ts.length < 2 || !!S.live;
  if (bar.hidden) return;
  const i = Math.max(0, ts.indexOf(viewTurn())), sc = $('#turnScrub');
  sc.max = String(ts.length); sc.value = String(i + 1); sc.disabled = false;
  sc.setAttribute('aria-valuetext', `Turn ${ts[i]} of ${ts.length}`);
  $('#turnPos').textContent = `Turn ${ts[i]} of ${ts.length}`;
  $('#turnPrev').disabled = i === 0; $('#turnNext').disabled = i === ts.length - 1; $('#turnLatest').disabled = !isHistory();
}
function renderComposer() {
  const off = !config.value?.live || S.readonly;
  $('#talkSend').hidden = !!S.busy; $('#talkStop').hidden = !S.busy;
  $('#talkSend').disabled = off; $('#talkInput').disabled = S.readonly || !config.value?.live;
  $('#mic').disabled = (off && !V.listening) || !SR || !!S.busy;
  $('#agentPick').disabled = !!S.busy || !!config.value?.public;
  for (const id of ['#actReflect', '#actReset']) $(id).disabled = off || !!S.busy;
  $('#talkInput').placeholder = S.readonly ? 'Read-only example.' : !config.value?.live ? 'This copy has no model to talk to.' : `Message ${AGENTS[S.agent]?.name || 'the agent'}. Enter sends. Shift+Enter adds a line.`;
  const eb = $('#errorBox'); eb.hidden = !S.error; eb.innerHTML = errorHtml(S.error);
  $('#memoryOn').disabled = !!S.busy || S.readonly;
  $('#readPanel').hidden = !!S.readonly;
}

// ---------- map and inspector ----------
let mapKey = '', ro = null;
function renderMap() {
  const mod = model(), root = $('#processMap');
  const opts = { selected: S.node, step: S.step };
  const html = mapHtml(mod, opts);
  const key = html + JSON.stringify(S.node);
  if (key !== mapKey) { mapKey = key; root.innerHTML = html; }
  drawEdges(root, mod, opts);
  if (!ro) ro = hookResize(root, () => drawEdges($('#processMap'), model(), { selected: S.node, step: S.step }));
  else { ro.disconnect(); const w = $('.mapwrap', root); if (w) ro.observe(w); }
  // replay controls
  const t = viewTurn(), canStep = !S.live && t != null;
  $('#stepStart').disabled = !canStep; $('#stepPrev').disabled = !canStep || S.step == null || S.step === 0; $('#stepNext').disabled = !canStep || S.step === STEPS.length - 1; $('#stepAll').disabled = !canStep || S.step == null;
  $('#stepStart').hidden = S.step != null; $('#stepPrev').hidden = $('#stepNext').hidden = $('#stepAll').hidden = S.step == null;
  $('#stepInfo').textContent = S.step == null ? '' : `Replay, stage ${S.step + 1} of ${STEPS.length}: ${STEPS[S.step].label}. This steps through the recorded stages. It is not live activity.`;
  const head = $('#mapStatus');
  head.innerHTML = `${statusChip(mod.overall.state === 'complete' ? 'done' : mod.overall.state === 'incomplete' ? 'partial' : mod.overall.state === 'processing' ? 'active' : 'missing')} <span>${esc(mod.overall.text)}</span>`;
  $('#mapTurn').textContent = S.live ? `Turn ${S.live.turn ?? ''} (in progress)` : t != null ? `Turn ${t}${isHistory() ? ' (history)' : ' (latest)'}` : 'No turn yet';
}
let inspKey = '';
function renderInspector() {
  const mod = model(), t = viewTurn(), m = S.mem;
  const head = $('#inspHead');
  head.className = `insp-head${isHistory() ? ' history' : ''}`;
  head.innerHTML = S.live ? '<div class="state"><h2>Inspector</h2><span class="chip accent">Live turn in progress</span></div>'
    : t != null ? `<div class="state"><h2>Inspector</h2>${isHistory() ? '<span class="chip warn">History: turn ' + t + '</span>' : '<span class="chip ok">Latest: turn ' + t + '</span>'}<span class="note">${esc(when(agentMsg(m, t)?.at))}</span></div>` : '<div class="state"><h2>Inspector</h2></div>';
  const body = $('#panel-inspector');
  const html = inspectorHtml(mod, S.node, { mem: S.mem, example: S.example });
  const key = html;
  if (key === inspKey) return;
  inspKey = key; body.innerHTML = html;
}
let atBottom = true;
function bottom() { const el = $('#chatLog'); if (atBottom && !isHistory()) el.scrollTop = el.scrollHeight; }
export function render() {
  renderSummary(); renderBanner(); renderConversation(); renderTurnBar(); renderComposer(); renderMap(); renderInspector(); bottom();
  const open = document.body.classList.contains('inspect-open');
  $('#inspectBtn').textContent = open ? 'Close details' : 'Details';
  $('#inspectBtn').setAttribute('aria-expanded', String(open));
}

// ---------- sending ----------
async function send(textOverride) {
  const input = $('#talkInput');
  const text = (textOverride ?? input.value).trim();
  if (!text || S.busy || S.readonly || !config.value?.live) return;
  S.pending = text; S.lastSent = text; input.value = ''; S.error = null; S.sel = null; S.step = null;
  S.live = emptyBrain();
  const ac = new AbortController(); S.job = ac; S.busy = 'Sending.';
  const inputKind = S.nextInput || 'typed'; S.nextInput = 'typed';
  const agent = S.agent;
  render();
  try {
    await stream('/api/talk/stream', { agent, text, input: inputKind, memory: $('#memoryOn').checked ? 'on' : 'off' }, (stage, data) => {
      if (agent !== S.agent) return;
      S.live = applyStage(S.live, stage, data);
      render();
    }, { signal: ac.signal });
    await refreshMem();
    speakLatest();
  } catch (e) {
    if (e.name === 'AbortError') S.error = { kind: 'cancelled', error: 'Stopped. No further model calls were made and nothing was saved for this turn.', retryText: text };
    else S.error = { ...(e.info || {}), error: e.message, kind: e.info?.kind || 'request', retryText: text };
    input.value = text;
    try { await refreshMem(); } catch { /* keep what we have */ }
  } finally { S.busy = null; S.job = null; S.pending = null; S.live = null; S.node = null; render(); input.focus(); }
}
const stop = () => S.job?.abort();

async function act(text, fn) {
  if (S.busy || S.readonly) return;
  S.busy = text; S.error = null; render();
  const ac = new AbortController(); S.job = ac;
  try { await fn(ac.signal); } catch (e) { S.error = e.name === 'AbortError' ? { kind: 'cancelled', error: 'Stopped.' } : { ...(e.info || {}), error: e.message, kind: e.info?.kind || 'request' }; }
  S.busy = null; S.job = null; render();
}

// ---------- reading ----------
const D = { running: false, status: '', rejected: 0, resumeAt: null };
async function readDigest() {
  const text = $('#dText').value.trim();
  if (!text || D.running || S.busy || S.readonly || !config.value?.live) return;
  D.running = true; D.rejected = 0; D.status = 'Starting.'; S.error = null;
  const ac = new AbortController(); S.job = ac; S.busy = 'Reading.';
  const agent = S.agent;
  render(); paintRead();
  try {
    await stream('/api/talk/digest', { agent, title: $('#dTitle').value, source: $('#dSource').value, text, startAt: D.resumeAt || 1, memory: $('#memoryOn').checked ? 'on' : 'off' }, async (stage, data) => {
      if (stage === 'passage') { D.status = `Reading passage ${data.n} of ${data.total}.`; S.busy = D.status; }
      if (stage === 'personality') D.rejected += data.rejected?.length || 0;
      if (stage === 'digested') { try { await refreshMem(); } catch { /* keep */ } }
      if (stage === 'done') D.status = `Finished ${data.passages} passages.${D.rejected ? ` ${D.rejected} proposed update${D.rejected > 1 ? 's were' : ' was'} rejected: the quote was not in the text.` : ''}`;
      render(); paintRead();
    }, { signal: ac.signal });
    $('#dText').value = ''; D.resumeAt = null;
  } catch (e) {
    if (e.name === 'AbortError') D.status = 'Stopped. Passages already read are saved.';
    else { D.status = e.message; D.resumeAt = e.info?.passage || null; S.error = { ...(e.info || {}), error: e.message, kind: e.info?.kind || 'request' }; }
  } finally { D.running = false; S.busy = null; S.job = null; try { await refreshMem(); } catch { /* keep */ } render(); paintRead(); }
}
function paintRead() {
  const on = !!config.value?.live && !S.readonly && !S.busy && !D.running;
  $('#dRead').disabled = !on; $('#dRead').textContent = D.resumeAt ? `Resume from passage ${D.resumeAt}` : 'Read it'; $('#dStop').hidden = !D.running; $('#dStatus').textContent = D.status;
}
let dRec = null;
function digestMic() {
  if (dRec) { dRec.stop(); return; }
  if (!SR) { D.status = 'Voice input needs Chrome or Edge.'; paintRead(); return; }
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
  const base = $('#dText').value.trim(); let final = '';
  rec.onresult = ev => { let interim = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { if (ev.results[i].isFinal) final += `${ev.results[i][0].transcript} `; else interim += ev.results[i][0].transcript; } $('#dText').value = [base, final.trim(), interim].filter(Boolean).join(' '); };
  rec.onerror = ev => { D.status = `Voice input error: ${ev.error}`; paintRead(); };
  rec.onend = () => { dRec = null; const b = $('#dMic'); if (b) { b.setAttribute('aria-pressed', 'false'); b.textContent = 'Speak the text'; } };
  dRec = rec; $('#dMic').setAttribute('aria-pressed', 'true'); $('#dMic').textContent = 'Stop listening'; rec.start();
}

// ---------- voice ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const V = { listening: false, rec: null, base: '' };
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
  u.onend = () => { if ($('#handsFree').checked && !S.busy) listen(); };
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

// ---------- selection helpers ----------
const mobile = () => matchMedia('(max-width: 960px)').matches;
function pickNode(id) { selectNode({ kind: 'node', id }); if (mobile()) document.body.classList.add('inspect-open'); render(); }
function pickEdge(id) { selectNode({ kind: 'edge', id }); if (mobile()) document.body.classList.add('inspect-open'); render(); }
function pickMemory(id) { selectNode({ kind: 'memory', id }); if (mobile()) document.body.classList.add('inspect-open'); render(); }
function pickProposal(id) { selectNode({ kind: 'proposal', id }); if (mobile()) document.body.classList.add('inspect-open'); render(); }
function setStep(i) { S.step = i; if (i != null) { const id = STEPS[i].id; S.node = { kind: 'node', id }; } notify(); }
function pane(p) { document.body.dataset.pane = p; for (const b of $$('#paneSeg [data-pane]')) b.setAttribute('aria-pressed', String(b.dataset.pane === p)); }

// ---------- init ----------
export async function initAgent() {
  $('#readAloud').checked = pref('readAloud', false); $('#handsFree').checked = pref('handsFree', false);
  $('#readAloud').onchange = e => { setPref('readAloud', e.target.checked); if (!e.target.checked) speechSynthesis?.cancel(); };
  $('#handsFree').onchange = e => setPref('handsFree', e.target.checked);
  if (!SR) $('#voiceNote').textContent = 'Voice input needs Chrome or Edge. Reading aloud still works.';
  if (window.speechSynthesis) { fillVoices(); speechSynthesis.onvoiceschanged = fillVoices; }
  $('#voicePick').onchange = e => setPref('voice', e.target.value);
  $('#mic').onclick = () => (V.listening ? V.rec?.stop() : listen());
  $('#composer').onsubmit = e => { e.preventDefault(); send(); };
  $('#talkInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
  $('#chatLog').addEventListener('scroll', () => { const el = $('#chatLog'); atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80; });
  $('#talkStop').onclick = stop;
  $('#agentPick').onchange = e => switchAgent(e.target.value);
  $('#inspectBtn').onclick = () => { document.body.classList.toggle('inspect-open'); render(); };
  $('#inspClose').onclick = () => { document.body.classList.remove('inspect-open'); render(); $('#inspectBtn').focus(); };
  $('#turnScrub').oninput = e => selectTurn(turns()[Number(e.target.value) - 1]);
  $('#turnPrev').onclick = () => { const t = turns(), i = t.indexOf(viewTurn()); if (i > 0) selectTurn(t[i - 1]); };
  $('#turnNext').onclick = () => { const t = turns(), i = t.indexOf(viewTurn()); if (i < t.length - 1) selectTurn(t[i + 1]); };
  $('#turnLatest').onclick = () => selectTurn(latest());
  $('#stepStart').onclick = () => setStep(0);
  $('#stepPrev').onclick = () => setStep(Math.max(0, (S.step ?? 0) - 1));
  $('#stepNext').onclick = () => setStep(Math.min(STEPS.length - 1, (S.step ?? -1) + 1));
  $('#stepAll').onclick = () => { S.step = null; notify(); };
  for (const b of $$('#paneSeg [data-pane]')) b.onclick = () => pane(b.dataset.pane);
  pane('convo');

  // map and inspector clicks, by delegation (both are regenerated)
  $('#processMap').addEventListener('click', e => {
    const p = e.target.closest('[data-proposal]'), mm = e.target.closest('[data-memory]'), n = e.target.closest('[data-pick-node]'), ed = e.target.closest('[data-edge]');
    if (p) pickProposal(p.dataset.proposal); else if (mm) pickMemory(mm.dataset.memory); else if (n) pickNode(n.dataset.pickNode); else if (ed) pickEdge(ed.dataset.edge);
  });
  $('#processMap').addEventListener('keydown', e => { const ed = e.target.closest?.('[data-edge]'); if (ed && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickEdge(ed.dataset.edge); } });
  $('#panel-inspector').addEventListener('click', e => { const n = e.target.closest('[data-pick-node]'), mm = e.target.closest('[data-pick-memory]'); if (n) pickNode(n.dataset.pickNode); else if (mm) pickMemory(mm.dataset.pickMemory); });
  $('#clearSel').onclick = () => { S.node = null; notify(); };

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'retry') { const t = S.error?.retryText; S.error = null; send(t); }
    else if (a === 'dismiss') { S.error = null; render(); }
    else if (a === 'latest') selectTurn(latest());
    else if (a === 'example') loadExample();
    else if (a === 'leave-example') { S.example = null; S.readonly = false; S.mem = null; loadState(); }
    else if (a === 'resume') { D.resumeAt = S.error?.passage; S.error = null; $('#readPanel').open = true; readDigest(); }
    else if (a === 'fresh') api('/api/talk/reset', { agent: S.agent, keepDamaged: true }).then(r => { S.mem = r.mem; S.error = null; render(); }).catch(err => { S.error = { error: err.message }; render(); });
  });
  const pick = e => {
    const el = e.target.closest('.msg[data-turn]'); if (!el) return;
    selectTurn(Number(el.dataset.turn), { node: { kind: 'node', id: el.dataset.pick } });
    $(`.msg[data-turn="${viewTurn()}"].agent`)?.scrollIntoView({ block: 'nearest' });
  };
  $('#chatLog').addEventListener('click', pick);
  $('#chatLog').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.msg[data-turn]')) { e.preventDefault(); pick(e); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('inspect-open')) { document.body.classList.remove('inspect-open'); render(); $('#inspectBtn').focus(); } });

  $('#actReflect').onclick = () => { $('#moreMenu').open = false; act(`${AGENTS[S.agent].name} is reviewing the record.`, async signal => { S.mem = (await api('/api/talk/reflect', { agent: S.agent, trigger: 'manual', memory: $('#memoryOn').checked ? 'on' : 'off' }, { signal })).mem; speakLatest(); }); };
  $('#actExport').onclick = () => { $('#moreMenu').open = false; if (!S.mem) return; const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(S.mem, null, 1)], { type: 'application/json' })), download: `stebula-memory-${S.agent}-${Date.now()}.json` }); a.click(); URL.revokeObjectURL(a.href); };
  $('#actReset').onclick = async () => {
    $('#moreMenu').open = false;
    if (!confirm(`Reset ${agentName(S.agent)}'s memory? The current file is kept as a backup in data/.`)) return;
    try { S.mem = (await api('/api/talk/reset', { agent: S.agent })).mem; S.sel = null; S.node = null; S.error = null; } catch (e) { S.error = { error: e.message }; }
    render();
  };
  $('#dRead').onclick = readDigest; $('#dStop').onclick = () => S.job?.abort(); $('#dMic').onclick = digestMic;
  $('#dFile').onchange = async e => { const file = e.target.files[0]; if (!file) return; $('#dText').value = await file.text(); if (!$('#dTitle').value) $('#dTitle').value = file.name.replace(/\.txt$/i, ''); };

  subscribe(() => { if (!$('#agentView').hidden) render(); });
  try { await api('/api/example'); S.exampleAvailable = true; } catch { S.exampleAvailable = false; }
  if (config.value?.public) { $('#agentPick').disabled = true; return loadExample(true); }
  await loadState();
  // After 30 minutes away the agent reviews the record. It never runs in the background.
  try {
    const j = await api(`/api/talk/state?agent=${S.agent}`);
    if (j.needsReflection && j.live) await act(`${AGENTS[S.agent].name} is reviewing your last conversation before you continue.`, async signal => { S.mem = (await api('/api/talk/reflect', { agent: S.agent, trigger: 'return' }, { signal })).mem; speakLatest(); });
  } catch { /* the state error is already shown */ }
}
export const agentActivated = () => { if (!S.mem && !S.readonly) loadState(); else render(); };
