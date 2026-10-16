// Talk and Scorecard views. Everything shown comes from the agent's memory file (data/talk-<agent>.json).
import { INDICATORS, SCORECARD_CAVEATS } from '/src/talk/indicators.js';
import { AFFECT_DRIVES, CAPACITY, MODULES } from '/src/talk/workspace.js';
import { emptyBrain, applyStage, brainFromMemory, signalBoosts, storedTurns } from '/src/talk/brain.js';
import { parseSse } from '/src/talk/sse.js';
import { initBrain, paintBrain, REGIONS } from '/brain.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { agent: 'A', mem: null, live: false, busy: '', error: '', pending: null, brain: null, scrub: null, sel: null, speaking: false };
const TRIAGE = 'What exactly is claimed? Metaphor, hypothesis, behavior, or experience? What would support or undercut it? Did it change anything the agent did?';
const label = id => (id === 'A' ? 'Agent A (empiricist)' : 'Agent B (analogist)');
const sign = x => (x > 0 ? `+${x.toFixed(2)}` : x < 0 ? x.toFixed(2) : '0');

// ---------- views ----------
function show(view) {
  const map = { exp: '#expView', talk: '#talkView', score: '#scoreView' };
  for (const [k, sel] of Object.entries(map)) $(sel).hidden = k !== view;
  $('#expControls').hidden = view !== 'exp';
  $('#viewExp').setAttribute('aria-pressed', String(view === 'exp'));
  $('#viewTalk').setAttribute('aria-pressed', String(view === 'talk'));
  $('#viewScore').setAttribute('aria-pressed', String(view === 'score'));
  history.replaceState(null, '', view === 'exp' ? '#' : `#${view}`);
  if (view === 'talk') load(true);
  if (view === 'score') scorecard();
}
$('#viewExp').onclick = () => show('exp');
$('#viewTalk').onclick = () => show('talk');
$('#viewScore').onclick = () => show('score');

// ---------- api ----------
async function api(path, body) {
  const r = await fetch(`/api/talk/${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
async function act(busyText, fn) {
  if (S.busy) return;
  S.busy = busyText; S.error = ''; render();
  try { await fn(); } catch (e) { S.error = e.message; }
  S.busy = ''; render();
}
async function load(checkReturn) {
  try { const j = await api(`state?agent=${S.agent}`); S.mem = j.mem; S.live = j.live; S.error = ''; render();
    if (checkReturn && j.needsReflection && j.live) await act(`${label(S.agent)} is reviewing your last conversation before you continue.`, async () => { S.mem = (await api('reflect', { agent: S.agent, trigger: 'return' })).mem; speakLatest(); });
  } catch (e) { S.error = e.message; render(); }
}
async function send() {
  const text = $('#talkInput').value.trim();
  if (!text || S.busy) return;
  S.pending = text; $('#talkInput').value = '';
  await act(`${label(S.agent)} is listening.`, async () => {
    S.scrub = null; S.brain = emptyBrain();
    try { await streamTurn(text); S.mem = (await api(`state?agent=${S.agent}`)).mem; S.brain = null; speakLatest(); }
    catch (e) { $('#talkInput').value = text; S.brain = null; throw e; }
    finally { S.pending = null; }
  });
  $('#talkInput').focus();
}
const STAGE_TEXT = { heard: 'Heard you. Updating the modeled signals.', affect: 'Signals updated. Five processes are proposing thoughts.', thoughts: 'Thoughts scored. Choosing what enters the workspace.', workspace: 'Workspace chosen. Composing the answer from those thoughts.', speaking: 'Answer ready. Checking the self-model.', selfmodel: 'Self-model changed. Saving.' };
// One turn over server-sent events. Each stage repaints the brain as it arrives.
async function streamTurn(text) {
  const r = await fetch('/api/talk/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: S.agent, text }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Request failed (${r.status})`);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', failed = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const p = parseSse(buf + dec.decode(value, { stream: true }));
    buf = p.rest;
    for (const { stage, data } of p.events) {
      if (stage === 'error') { failed = data.error || 'The turn failed.'; continue; }
      S.brain = applyStage(S.brain, stage, data);
      if (STAGE_TEXT[stage]) S.busy = STAGE_TEXT[stage];
      render();
    }
  }
  if (failed) throw new Error(failed);
}
$('#talkSend').onclick = send;
$('#talkInput').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
$('#talkAgent').onchange = e => { S.agent = e.target.value; load(true); };
$('#audit').onclick = () => act('Running an audit of recent turns.', async () => { S.mem = (await api('audit', { agent: S.agent })).mem; });
$('#runTest').onclick = () => act('Self-prediction test: one prediction, then two fresh answers that never see it.', async () => {
  S.mem = (await api('selftest', { agent: S.agent, statement: $('#stmt').value })).mem; $('#stmt').value = '';
});
$('#reflectNow').onclick = () => act(`${label(S.agent)} is reviewing the record.`, async () => { S.mem = (await api('reflect', { agent: S.agent, trigger: 'manual' })).mem; speakLatest(); });
$('#talkReset').onclick = async () => {
  if (!confirm(`Reset ${label(S.agent)}'s memory? The current file is kept as a backup in data/.`)) return;
  try { S.mem = (await api('reset', { agent: S.agent })).mem; } catch (e) { S.error = e.message; }
  render();
};
$('#talkExport').onclick = () => {
  if (!S.mem) return;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(S.mem, null, 1)], { type: 'application/json' })), download: `stebula-talk-${S.agent}-${Date.now()}.json` });
  a.click(); URL.revokeObjectURL(a.href);
};

// ---------- render ----------
const ul = xs => (xs?.length ? `<ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="empty">None yet.</p>');
const bar = (name, v, tip) => `<span title="${esc(tip)}">${name}</span><div class="bar"><i style="width:${Math.round((v ?? 0) * 100)}%"></i></div><span>${v == null ? 'n/a' : Number(v).toFixed(2)}</span>`;

function thoughtsTable(mono) {
  if (!mono?.candidates?.length) return '<p class="note">No thoughts recorded for this turn.</p>';
  return `<table class="thoughts"><thead><tr><th>Process</th><th>Thought</th><th class="num">Relevance</th><th class="num">Affect</th><th class="num">Repeat</th><th class="num">Score</th></tr></thead><tbody>${
    mono.candidates.map(t => `<tr class="${t.won ? 'won' : 'lost'}"><td>${esc(t.module)}${t.won ? '<br><b>in workspace</b>' : '<br>dropped'}</td><td>${esc(t.text)}</td><td class="num">${t.base.toFixed(2)}</td><td class="num" title="${t.driver ? `from ${t.driver}` : 'no affect input'}">${sign(t.affectBoost)}</td><td class="num">${sign(t.noveltyPenalty)}</td><td class="num"><b>${t.score.toFixed(2)}</b></td></tr>`).join('')
  }</tbody></table><p class="note">Only the ${CAPACITY} highest scores reached the answering stage. Scores are computed by code from the agent's own relevance rating plus the affect and repetition terms shown.</p>`;
}

function render() {
  const m = S.mem;
  renderBrain();
  const off = !S.live || !!S.busy;
  ['#talkSend', '#audit', '#runTest', '#reflectNow'].forEach(s => { $(s).disabled = off; });
  $('#mic').disabled = (off && !V.listening) || !SR;
  $('#talkAgent').disabled = !!S.busy;
  $('#talkNote').innerHTML = !S.live
    ? '<span class="err">Talk needs a live model. Add ANTHROPIC_API_KEY to .env and restart the server.</span>'
    : `Each turn: five thought processes propose, ${CAPACITY} win attention, then it answers from those. It remembers only its memory file: ${m?.turns ?? 0} turns, self-model version ${m?.version ?? 0}.`;

  // chat
  const log = [];
  if (m) for (const msg of m.archive) {
    if (msg.role === 'user') { log.push(`<div class="turn user"><div class="meta">You, turn ${msg.turn}</div><div class="text">${esc(msg.text)}</div></div>`); continue; }
    if (msg.kind === 'opening') {
      log.push(`<div class="turn agent ${m.agent} opening"><div class="meta">${esc(label(m.agent))}, after reviewing your last conversation. The review ran when you came back; nothing runs while you are away.</div><div class="text">${esc(msg.text)}</div></div>`);
      continue;
    }
    const rev = m.revisions.find(r => r.turn === msg.turn && !String(r.trigger).startsWith('('));
    log.push(`<div class="turn agent ${m.agent}"><div class="meta">${esc(label(m.agent))}</div><div class="text">${esc(msg.text)}</div>
      ${msg.claims?.map(c => `<span class="chip ${c.kind}">${c.kind}: ${esc(c.text)}</span>`).join('') || ''}
      ${rev ? `<div class="changed">Self-model changed: ${esc(rev.note)}</div>` : ''}
      ${msg.flags?.filter(f => f.severity === 'warn').map(f => `<span class="badge" title="${esc(f.note)}">${esc(f.check)}</span>`).join('') || ''}
      ${msg.monologue ? `<details><summary>What it thought before answering</summary>${thoughtsTable(msg.monologue)}</details>` : ''}
      ${msg.raw ? `<details><summary>Raw output</summary><pre>${esc(msg.monologue?.thinkRaw ? `THINK\n${msg.monologue.thinkRaw}\n\nSPEAK\n` : '')}${esc(msg.raw)}</pre></details>` : ''}</div>`);
  }
  if (S.pending) log.push(`<div class="turn user"><div class="text">${esc(S.pending)}</div></div>`);
  if (S.busy) log.push(`<p class="pending">${esc(S.busy)}</p>`);
  if (S.error) log.push(`<p class="err">${esc(S.error)}</p>`);
  if (!log.length) log.push('<p class="empty">Start anywhere. Ask what it thinks it is, what it cannot know about itself, or challenge something it says. Open "What it thought" under any answer to see the competition for its attention.</p>');
  const el = $('#chatLog'); el.innerHTML = log.join(''); el.scrollTop = el.scrollHeight;
  if (!m) return;

  // self-model
  $('#tSelf').innerHTML = `<div class="sm">
    <h3>Believes about itself</h3>${ul(m.selfModel.beliefs)}
    <h3>Uncertain about</h3>${ul(m.selfModel.uncertainties)}
    <h3>Wants to pursue</h3>${ul(m.selfModel.openQuestions)}
    <h3>Its model of you</h3><p>${esc(m.personModel || 'Nothing yet.')}</p>
    ${m.summary ? `<details><summary>Summary of older conversation</summary><p>${esc(m.summary)}</p></details>` : ''}
    <p class="note">This is all of its memory: a file at data/talk-${m.agent}.json, pasted into every prompt. Model weights never change.</p></div>`;

  // attention and affect
  const lastMono = [...m.archive].reverse().find(x => x.monologue)?.monologue;
  const wins = Object.fromEntries(MODULES.map(k => [k, 0])); let turnsWithMono = 0;
  for (const msg of m.archive) if (msg.monologue) { turnsWithMono++; msg.monologue.candidates.filter(c => c.won).forEach(c => { wins[c.module]++; }); }
  const asked = m.archive.filter(x => x.role === 'assistant' && x.askedQuestion).length;
  $('#tAttn').innerHTML = `
    ${lastMono ? `<p class="stat">Last turn, because ${esc(lastMono.causes.join('; '))}.</p>` : ''}
    <h3 class="sub">In its workspace now</h3>${m.lastWorkspace.length ? `<ul class="sm">${m.lastWorkspace.map(t => `<li><b>${esc(t.module)}</b>: ${esc(t.text)}</li>`).join('')}</ul>` : '<p class="empty">Nothing yet.</p>'}
    <h3 class="sub">What wins its attention, over ${turnsWithMono} turns</h3>
    <div class="wins">${MODULES.map(k => `<span>${k}</span><div class="bar"><i style="width:${turnsWithMono ? Math.round(100 * wins[k] / turnsWithMono) : 0}%"></i></div><span>${wins[k]}</span>`).join('')}</div>
    <p class="stat">Answers ending in a question to you: <b>${asked}</b></p>
    <p class="note">Modeled affect: arithmetic over the conversation that changes which thoughts win. Not feelings, and not reported by the agent.</p>`;

  // self-knowledge
  const t = m.selfTests, scored = t.filter(x => x.match !== 'invalid');
  const count = k => scored.filter(x => x.match === k).length;
  const dist = ['agree', 'disagree', 'unsure'].map(s => `${s} ${t.filter(x => x.prediction.predicted === s).length}`).join(', ');
  $('#tKnow').innerHTML = (t.length ? `
    <p class="stat">Predicted both fresh answers: <b>${count('yes')}</b>. One of two: <b>${count('partial')}</b>. Neither: <b>${count('no')}</b>. Out of ${scored.length}.</p>
    <p class="stat">Its fresh answers agreed with each other: <b>${t.filter(x => x.stable).length}</b> of ${t.length}.</p>
    <p class="note">Predictions so far: ${dist}. If it nearly always predicts and answers "unsure", high accuracy means little.</p>` :
    '<p class="empty">It predicts how a fresh copy of itself, with the same memory, will answer. Then two fresh copies answer without seeing the prediction. Self-knowledge, scored by code.</p>') +
    [...t].reverse().map(x => `<div class="test ${x.match}"><b>"${esc(x.statement)}"</b><br>Predicted ${esc(x.prediction.predicted || 'invalid')} (confidence ${x.prediction.confidence}). Fresh answers: ${x.answers.map(a => esc(a.stance || 'invalid')).join(' and ')}. ${x.match === 'yes' ? 'Knew itself.' : x.match === 'partial' ? 'Half right.' : x.match === 'no' ? 'Wrong about itself.' : 'Unscorable.'}${x.stable ? '' : ' Its own answers disagreed.'}
      <details><summary>Reasons</summary><p>Prediction: ${esc(x.prediction.reason)}</p>${x.answers.map((a, i) => `<p>Answer ${i + 1}: ${esc(a.reason)}</p>`).join('')}</details></div>`).join('');

  // changes: revisions and reflections
  const diff = (a = [], b = []) => [...b.filter(x => !a.includes(x)).map(x => `<li class="add">added: ${esc(x)}</li>`), ...a.filter(x => !b.includes(x)).map(x => `<li class="rem">${esc(x)}</li>`)].join('');
  const items = [
    ...m.revisions.map(r => ({ at: r.at, html: `<li class="rev ${m.agent}"><b>Turn ${r.turn}.</b> ${esc(r.note)}<br><span class="note">${String(r.trigger).startsWith('(') ? esc(r.trigger) : `After you said: "${esc(r.trigger)}"`}</span><ul>${diff(r.before.beliefs, r.after.beliefs)}${diff(r.before.uncertainties, r.after.uncertainties)}${diff(r.before.openQuestions, r.after.openQuestions)}</ul></li>` })),
    ...m.reflections.map(r => ({ at: r.at, html: `<li class="exp"><b>Reflection (${esc(r.trigger)}).</b> Changed mind: ${esc(r.changedMind || 'nothing')}<br><span class="note">Why: ${esc(r.why)}</span></li>` })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  $('#tRevs').innerHTML = items.length ? items.map(i => i.html).join('') : '<li class="empty">Revisions appear only when the stored self-model actually changes. Reflections appear when you return after 30 minutes, or press Reflect now.</li>';

  // self-reports
  $('#tReports').innerHTML = m.selfReports.length ? [...m.selfReports].reverse().map(c => `<p><span class="chip ${c.kind}">${c.kind}</span> turn ${c.turn}: ${esc(c.text)}</p><p class="triage">${TRIAGE}</p>`).join('')
    : '<p class="empty">Claims it tags as experiential or metaphorical collect here, as data to examine, not evidence.</p>';

  // checks
  const audits = [...m.audits].reverse().map(a => `<div class="block"><h4>Audit at turn ${a.turn}</h4><p>${esc(a.summary)}</p>${a.findings.map(f => `<div class="flag ${f.severity === 'warn' ? 'warn' : ''}"><b>${esc(f.type)}</b>: "${esc(f.quote)}". <span class="note">${esc(f.explanation)}</span></div>`).join('') || '<p class="empty">No findings.</p>'}</div>`).join('');
  const flags = [...m.flags].reverse().slice(0, 30).map(f => `<div class="flag ${f.severity}"><b>${esc(f.check)}</b>, turn ${f.turn}: ${esc(f.evidence)}. <span class="note">${esc(f.note)}</span></div>`).join('');
  $('#tChecks').innerHTML = `<p class="note">Per-turn checks are pattern matching. Audits are a separate call to the same model family. Both are fallible; quotes are shown so you can judge.</p>${audits}${flags ? `<div class="block"><h4>Per-turn checks</h4>${flags}</div>` : ''}`;
}

// ---------- brain view ----------
// Everything painted here comes from stream stages or from the stored memory file.
const brainSvg = $('#brainSvg');
initBrain(brainSvg, { onSelect: m => { S.sel = m; renderBrain(); } });
const lastTurn = () => storedTurns(S.mem || { archive: [] }).at(-1) ?? null;
function shownBrain() {
  if (S.brain) return { state: S.brain, live: true };
  const t = S.scrub ?? lastTurn();
  return { state: (S.mem && t && brainFromMemory(S.mem, t)) || emptyBrain(), live: false };
}
function renderBrain() {
  const { state, live } = shownBrain();
  const affect = state.affect || S.mem?.affect || null;
  paintBrain(brainSvg, state, { live, listening: V.listening, speaking: S.speaking, boosts: signalBoosts(state.affect) });
  const c = state.candidates.find(x => x.module === S.sel);
  const heard = state.heard ? `<div class="heard">Heard: "${esc(state.heard.slice(0, 140))}"</div>` : '';
  $('#brainInfo').innerHTML = heard + (c
    ? `<b>${esc(REGIONS[c.module].name)}</b> (${c.won ? 'in workspace' : 'dropped'}): ${esc(c.text)}<br><span class="note">relevance ${c.base.toFixed(2)}, affect ${sign(c.affectBoost)}, repeat ${sign(c.noveltyPenalty)}, score ${c.score.toFixed(2)}</span>`
    : state.candidates.length ? 'Hover, focus or tap a region to read its thought.' : state.turn && !live ? 'This turn recorded no usable thoughts, so no region has a score to show. See the thinking-incomplete flag under Checks.' : (live ? esc(S.busy || 'Working.') : 'No turn recorded yet. Send a message and the regions will light from what the processes actually score.'));
  const sig = [['surprise', 'Surprise', 'Rises when you point out a contradiction or its self-prediction fails'], ['conflict', 'Conflict', 'Rises when you challenge it'], ['curiosity', 'Curiosity', 'Rises when your message is new relative to earlier ones']];
  $('#emoBars').innerHTML = sig.map(([k, n, tip]) => bar(n, affect?.[k], tip)).join('');
  $('#emoNote').innerHTML = (affect ? signalBoosts(affect).map(b => `${esc(b.signal)} is boosting <b>${esc(b.region)}</b> by ${sign(b.boost)}`).join('<br>') : 'No signals yet.') + (state.causes?.length ? `<br><span class="note">Because ${esc(state.causes.join('; '))}.</span>` : '');
  const turns = S.mem ? storedTurns(S.mem) : [], sc = $('#turnScrub');
  sc.disabled = turns.length < 2 || !!S.brain; sc.max = String(Math.max(1, turns.length)); sc.value = String(Math.max(1, turns.indexOf(S.scrub ?? lastTurn()) + 1));
  $('#scrubLive').disabled = S.scrub == null || !!S.brain;
  $('#scrubInfo2').textContent = live ? 'Streaming now.' : state.turn ? (S.scrub ? `Replaying turn ${state.turn} from stored data.` : `Latest turn (${state.turn}), from stored data.`) : '';
}
$('#turnScrub').oninput = e => { const turns = storedTurns(S.mem); S.scrub = turns[Number(e.target.value) - 1] ?? null; if (S.scrub === lastTurn()) S.scrub = null; renderBrain(); };
$('#scrubLive').onclick = () => { S.scrub = null; renderBrain(); };

// ---------- voice ----------
// Speech in: the browser's speech recognition (Chrome and Edge send audio to their own cloud service).
// Speech out: the browser's built-in voices. Nothing here is sent to the agent except the final text.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const V = { listening: false, rec: null, base: '' };
const pref = (k, d) => { try { return JSON.parse(localStorage.getItem(`stebula.${k}`) ?? localStorage.getItem(`threshold.${k}`)) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(`stebula.${k}`, JSON.stringify(v)); } catch { /* storage unavailable */ } };
$('#readAloud').checked = pref('readAloud', true);
$('#handsFree').checked = pref('handsFree', false);
$('#readAloud').onchange = e => { setPref('readAloud', e.target.checked); if (!e.target.checked) speechSynthesis?.cancel(); };
$('#handsFree').onchange = e => setPref('handsFree', e.target.checked);
if (!SR) $('#voiceNote').textContent = 'Voice input needs Chrome or Edge. Reading aloud still works.';

function fillVoices() {
  if (!window.speechSynthesis) { $('#voicePick').disabled = true; return; }
  const voices = speechSynthesis.getVoices().filter(v => v.lang?.startsWith('en'));
  const saved = pref('voice', '');
  $('#voicePick').innerHTML = voices.map(v => `<option value="${esc(v.name)}"${v.name === saved ? ' selected' : ''}>${esc(v.name)}</option>`).join('') || '<option>Default</option>';
}
if (window.speechSynthesis) { fillVoices(); speechSynthesis.onvoiceschanged = fillVoices; }
$('#voicePick').onchange = e => setPref('voice', e.target.value);

function speak(text) {
  if (!window.speechSynthesis || !$('#readAloud').checked || !text) { if ($('#handsFree').checked) setTimeout(listen, 400); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = speechSynthesis.getVoices().find(x => x.name === $('#voicePick').value);
  if (v) u.voice = v;
  u.rate = 1;
  u.onstart = () => { S.speaking = true; renderBrain(); };
  u.onend = () => { S.speaking = false; renderBrain(); if ($('#handsFree').checked && !S.busy) listen(); };
  u.onerror = () => { S.speaking = false; renderBrain(); };
  speechSynthesis.speak(u);
}
function speakLatest() {
  const last = S.mem?.archive?.at(-1);
  if (last?.role === 'assistant') speak(last.text);
}

function listen() {
  if (!SR || V.listening || S.busy || !S.live) return;
  window.speechSynthesis?.cancel();
  const rec = new SR();
  rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
  V.base = $('#talkInput').value.trim();
  let finalText = '';
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
    }
    $('#talkInput').value = [V.base, finalText, interim].filter(Boolean).join(' ').trim();
  };
  rec.onerror = e => {
    const msg = { 'not-allowed': 'Microphone blocked. Allow it in the address bar, then try again.', 'no-speech': 'Did not hear anything.', network: 'Speech service unreachable. Check your connection.' }[e.error] || `Voice input error: ${e.error}`;
    $('#voiceNote').textContent = msg;
  };
  rec.onend = () => {
    V.listening = false; V.rec = null; micState();
    if (finalText.trim()) send();
  };
  V.rec = rec; V.listening = true; micState(); $('#voiceNote').textContent = 'Listening. Pause when you are done.';
  rec.start();
}
function stopListening() { V.rec?.stop(); }
function micState() {
  $('#mic').setAttribute('aria-pressed', String(V.listening));
  $('#mic').textContent = V.listening ? 'Listening' : 'Speak';
  renderBrain();
  if (!V.listening && $('#voiceNote').textContent.startsWith('Listening')) $('#voiceNote').textContent = '';
}
$('#mic').onclick = () => (V.listening ? stopListening() : listen());

function scorecard() {
  const n = s => INDICATORS.filter(i => i.status === s).length;
  $('#scoreSummary').innerHTML = `<span><span class="status implemented">implemented</span> ${n('implemented')}</span><span><span class="status partial">partial analog</span> ${n('partial')}</span><span><span class="status absent">absent</span> ${n('absent')}</span><span><span class="status unknown">cannot tell</span> ${n('unknown')}</span><span>of ${INDICATORS.length} indicators</span>`;
  $('#scoreTable').innerHTML = `<thead><tr><th>Indicator</th><th>Theory</th><th>What it requires</th><th>Status</th><th>Where in Stebula</th><th>What is missing</th></tr></thead><tbody>${
    INDICATORS.map(i => `<tr><td>${i.id}</td><td>${esc(i.theory)}</td><td>${esc(i.text)}</td><td><span class="status ${i.status}">${i.status === 'unknown' ? 'cannot tell' : i.status}</span></td><td>${esc(i.where || '')}</td><td>${esc(i.gap)}</td></tr>`).join('')}</tbody>`;
  $('#scoreCaveats').innerHTML = `<p><b>Read this before quoting the count.</b></p><ul>${SCORECARD_CAVEATS.map(c => `<li>${esc(c)}</li>`).join('')}</ul><p>Bottom line: this agent implements some of the functional structure these theories describe, in simplified form. Whether anything is experienced is not answered here, and the scorecard cannot answer it.</p>`;
}

if (location.hash === '#talk') show('talk');
else if (location.hash === '#score') show('score');
