// History: revisit conversations, memories, reflections and changes. Pick a moment and see the state recorded then.
// A past turn is drawn from its own records. Anything that was not recorded is listed as a gap, never filled
// from the agent's current memory.
import { $, $$, esc, when, fmt } from '/core.js';
import { overviewModel } from '/src/talk/overview.js';
import { overviewHtml } from '/overview.js';
import { bindOpeners } from '/drawer.js';
import { S, AGENTS, agentName, subscribe, notify, turns, latest, selectTurn, openDetail } from '/store.js';
import { processModel, historyMoments, stateAt, agentMsg, userMsg } from '/src/talk/process.js';
import { renderGrowth, initGrowth } from '/growth.js';

const H = { filter: 'all', moment: null };
const FILTERS = [['all', 'Everything'], ['turn', 'Conversation'], ['reading', 'Readings and memories'], ['reflection', 'Reflections'], ['check', 'Checks']];
const KIND_GROUP = { turn: 'turn', reading: 'reading', fold: 'reading', reflection: 'reflection', 'reflection-opening': 'reflection', test: 'check', audit: 'check' };
const KIND_LABEL = { turn: 'Turn', reading: 'Reading', fold: 'Summary', reflection: 'Reflection', 'reflection-opening': 'Reflection', test: 'Self-test', audit: 'Audit' };

const all = () => historyMoments(S.mem);
const shown = () => all().filter(m => H.filter === 'all' || KIND_GROUP[m.kind] === H.filter).reverse();
function current() {
  const list = all();
  if (H.moment) { const m = list.find(x => x.id === H.moment); if (m) return m; }
  const t = S.sel ?? latest();
  return list.find(x => x.id === `turn-${t}`) ?? list.at(-1) ?? null;
}

function renderList() {
  const list = shown(), cur = current();
  $('#hFilters').innerHTML = FILTERS.map(([k, n]) => `<button class="seg-btn" data-filter="${k}" aria-pressed="${H.filter === k}">${esc(n)}</button>`).join('');
  $('#hList').innerHTML = list.length ? list.map(m => `<li><button class="moment${cur?.id === m.id ? ' sel' : ''}${m.degraded ? ' degraded' : ''}" data-moment="${esc(m.id)}" aria-current="${cur?.id === m.id}">
      <span class="mkind">${esc(KIND_LABEL[m.kind])}${m.kind === 'turn' && m.turn === latest() ? ' (latest)' : ''}</span><span class="mtitle">${esc(m.kind === 'turn' ? m.summary || m.title : m.title)}</span>
      <span class="note">${esc(when(m.at))}${m.kind === 'turn' ? `, turn ${m.turn}` : ''}${m.degraded ? ', incomplete' : ''}${m.changed ? ', memory changed' : ''}</span></button></li>`).join('') : '<li class="empty">Nothing recorded yet for this filter.</li>';
}

const listOf = xs => (xs?.length ? `<ul class="list">${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="nodata">None recorded.</p>');
function stateHtml(st) {
  return `<h3>State recorded at this moment</h3>
    <p class="note">Self-description version ${st.version}. ${st.turns} turn${st.turns === 1 ? '' : 's'} and ${st.readings.length} reading${st.readings.length === 1 ? '' : 's'} had been saved by then.</p>
    <div class="cols"><div><h4>Believes</h4>${listOf(st.self.beliefs)}</div><div><h4>Unsure about</h4>${listOf(st.self.uncertainties)}</div><div><h4>Wants to pursue</h4>${listOf(st.self.openQuestions)}</div></div>
    ${st.readings.length ? `<h4>Readings stored then</h4><ul class="list">${st.readings.slice(-6).map(e => `<li><button class="linkish" data-hist-memory="${esc(e.id)}"><b>${esc(e.id)}</b> ${esc(e.source)}, passage ${e.passage}</button></li>`).join('')}</ul>` : '<p class="nodata">No readings had been stored yet.</p>'}
    <details class="gaps" open><summary>What cannot be shown for this moment</summary><ul class="list">${st.gaps.map(g => `<li>${esc(g)}</li>`).join('')}</ul></details>`;
}

function renderDetail() {
  const m = current(), box = $('#hDetail');
  if (!S.mem || !m) { $('#hState').innerHTML = ''; box.innerHTML = '<div class="empty"><p><b>No history yet.</b> Conversations, readings and reflections appear here as they are recorded.</p></div>'; $('#hOverview').hidden = true; return; }
  const st = stateAt(S.mem, m.at), isLatest = m.kind === 'turn' && m.turn === latest();
  const banner = `<div class="banner${isLatest ? ' info' : ''}"><b>${isLatest ? 'Latest turn.' : 'Viewing history.'}</b> ${esc(KIND_LABEL[m.kind])} recorded ${esc(when(m.at))}. ${isLatest ? '' : 'This is the state as recorded then, not the agent\'s current state.'} <button class="btn small" data-hist-open>${m.kind === 'turn' ? 'Open this turn in the Agent view' : 'Go to the Agent view'}</button></div>`;
  let main = '';
  if (m.kind === 'turn') {
    const u = userMsg(S.mem, m.turn), a = agentMsg(S.mem, m.turn);
    main = `<div class="exchange"><div class="msg user"><div class="who">You, turn ${m.turn}</div><div class="text">${esc(u?.text || '')}</div></div>
      <div class="msg agent${a?.degraded ? ' degraded' : ''}"><div class="who">${esc(agentName(S.mem.agent))}</div><div class="text">${esc(a?.text || '')}</div></div></div>`;
  } else if (m.kind === 'reading' || m.kind === 'fold') {
    main = `<p class="lead">${esc(m.title)}</p><p>${esc(m.summary)}</p><p><button class="btn small" data-hist-memory="${esc(m.episode)}">Open this memory</button></p>`;
  } else if (m.kind === 'reflection' || m.kind === 'reflection-opening') {
    const r = (S.mem.reflections || []).find(x => x.at === m.at);
    main = r ? `<p class="lead">The agent reviewed its own record (${esc(r.trigger)}). Nothing ran in between: this review happened at the time shown.</p><h4>What it said changed</h4><p>${esc(r.changedMind || 'nothing')}</p><h4>Why</h4><p>${esc(r.why || '')}</p>${r.opening ? `<h4>What it said when you came back</h4><blockquote class="quote">${esc(r.opening)}</blockquote>` : ''}<p class="note">Written by the model. Self-description ${r.selfModelChanged ? 'was changed by this review.' : 'was not changed by this review.'}</p>` : `<p>${esc(m.summary)}</p>`;
  } else if (m.kind === 'test') {
    const t = (S.mem.selfTests || []).find(x => x.at === m.at);
    main = `<p class="lead">A self-prediction test: the agent predicted how fresh copies of itself would answer a statement.</p><blockquote class="quote">${esc(t?.statement || m.summary)}</blockquote><p>${t?.match === 'invalid' ? 'Invalid: an unreadable output. Not counted.' : `Predicted ${esc(t?.prediction?.predicted)} at confidence ${fmt(t?.prediction?.confidence)}. Fresh answers: ${(t?.answers || []).map(a => esc(a.stance || '?')).join(' and ')}. Result: ${esc(t?.match)}.`}</p>`;
  } else main = `<p class="lead">${esc(m.title)}</p><p>${esc(m.summary)}</p>`;
  box.innerHTML = `${banner}${main}`; $('#hState').innerHTML = stateHtml(st);

  const isTurn = m.kind === 'turn';
  $('#hOverview').hidden = !isTurn;
  if (isTurn) {
    const mod = processModel({ mem: S.mem, turn: m.turn, agent: S.agent });
    $('#hOvBody').innerHTML = overviewHtml(overviewModel(mod), { memoryItems: mod.nodes.memories.items }) + '<p><button class="btn small" data-open=\'{"kind":"diagram","id":"all"}\'>Process diagram</button></p>';
  }
  if (S.mem && $('#growthSvg')) renderGrowth(S.mem);
}

export function render() { if (!S.mem) { $('#hList').innerHTML = '<li class="empty">Loading.</li>'; $('#hFilters').innerHTML = ''; $('#hDetail').innerHTML = ''; return; } renderList(); renderDetail(); }

export function initHistory() {
  initGrowth();
  $('#hFilters').addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (b) { H.filter = b.dataset.filter; render(); } });
  $('#hList').addEventListener('click', e => {
    const b = e.target.closest('[data-moment]'); if (!b) return;
    const m = all().find(x => x.id === b.dataset.moment); if (!m) return;
    H.moment = m.id; if (m.kind === 'turn') selectTurn(m.turn); else notify();
  });
  const root = $('#historyView');
  bindOpeners(root);
  root.addEventListener('click', e => {
    const mm = e.target.closest('[data-hist-memory]');
    if (mm) { openDetail({ kind: 'memory', id: mm.dataset.histMemory }); return; }
    if (e.target.closest('[data-hist-open]')) dispatchEvent(new CustomEvent('stebula:go', { detail: 'agent' }));
  });
  subscribe(() => { if (!$('#historyView').hidden) render(); });
}
export const historyActivated = () => { if (S.sel == null) H.moment = null; render(); };
