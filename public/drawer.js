// The detail drawer: one record at a time, opened from the overview and closed with Back, Close or Escape.
// On a phone it is a full-screen sheet. It shows the same turn as the conversation and overview.
import { $, esc, when } from '/core.js';
import { S, subscribe, viewTurn, isHistory, openDetail, backDetail, closeDetail, selectTurn, notify, showingLive } from '/store.js';
import { processModel, STEPS, agentMsg } from '/src/talk/process.js';
import { inspectorHtml } from '/inspector.js';
import { mapHtml, drawEdges, hookResize } from '/map.js';

export const currentModel = () => processModel({ mem: S.mem, turn: viewTurn(), live: S.live ?? S.failedTurn, agent: S.agent });
const TITLE = { diagram: 'Process diagram', node: null, edge: 'Connection', proposal: 'Proposal', memory: 'Stored memory' };
let ro = null, lastKey = '';

function diagramHtml(model) {
  const t = viewTurn(), canStep = !showingLive() && t != null;
  const steps = canStep ? `<div class="steps" role="group" aria-label="Step through the recorded stages">
      ${S.step == null ? '<button class="btn small" data-step="start">Step through the stages</button>' : `<button class="btn small" data-step="prev"${S.step === 0 ? ' disabled' : ''}>Previous stage</button><button class="btn small" data-step="next"${S.step === STEPS.length - 1 ? ' disabled' : ''}>Next stage</button><button class="btn ghost small" data-step="all">Show all</button>`}</div>` : '';
  const info = S.step == null ? '' : `<p class="stepinfo" role="status">Replay, stage ${S.step + 1} of ${STEPS.length}: ${esc(STEPS[S.step].label)}. This steps through saved records. It is not live activity.</p>`;
  return `<p class="lead">Every stage of the turn and the hand-offs between them. Select a stage or a line for its record.</p>${steps}${info}${mapHtml(model, { selected: null, step: S.step })}`;
}

export function renderDrawer() {
  const d = $('#drawer'), sel = S.node;
  d.hidden = !sel; document.body.classList.toggle('drawer-open', !!sel);
  if (!sel) { lastKey = ''; return; }
  const model = currentModel();
  const body = $('#drawerBody');
  const html = sel.kind === 'diagram' ? diagramHtml(model) : inspectorHtml(model, sel, { mem: S.mem, example: S.example });
  const t = viewTurn(), a = t != null ? agentMsg(S.mem, t) : null;
  $('#drawerCtx').innerHTML = showingLive() ? '<span class="chip accent">This turn</span>' : t != null ? `${isHistory() ? '<span class="chip warn">History: turn ' + t + '</span>' : '<span class="chip ok">Latest: turn ' + t + '</span>'}` : '';
  $('#drawerBack').hidden = !S.stack.length;
  const key = JSON.stringify([sel, S.step, html]);
  if (key !== lastKey) {
    const first = !lastKey;
    lastKey = key; body.innerHTML = html;
    if (sel.kind === 'diagram') {
      const opts = { selected: null, step: S.step };
      drawEdges(body, model, opts);
      if (ro) ro.disconnect(); ro = hookResize(body, () => drawEdges(body, currentModel(), { selected: null, step: S.step }));
    }
    $('#drawerTitle').textContent = sel.kind === 'node' ? (model.nodes[sel.id]?.title ?? 'Details') : TITLE[sel.kind] || 'Details';
    if (first) setTimeout(() => $('#drawerTitle').focus(), 0);
  }
}

export function initDrawer() {
  $('#drawerClose').onclick = closeDetail;
  $('#drawerBack').onclick = backDetail;
  $('#drawer').addEventListener('click', e => {
    const n = e.target.closest('[data-pick-node]'), mm = e.target.closest('[data-pick-memory]'), ed = e.target.closest('[data-edge]'), p = e.target.closest('[data-proposal]'), st = e.target.closest('[data-step]');
    if (st) { const k = st.dataset.step; S.step = k === 'start' ? 0 : k === 'all' ? null : k === 'next' ? Math.min(STEPS.length - 1, (S.step ?? -1) + 1) : Math.max(0, (S.step ?? 0) - 1); notify(); return; }
    if (n) openDetail({ kind: 'node', id: n.dataset.pickNode });
    else if (mm) openDetail({ kind: 'memory', id: mm.dataset.pickMemory });
    else if (ed) openDetail({ kind: 'edge', id: ed.dataset.edge });
    else if (p) openDetail({ kind: 'proposal', id: p.dataset.proposal });
  });
  $('#drawer').addEventListener('keydown', e => { const ed = e.target.closest?.('[data-edge]'); if (ed && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail({ kind: 'edge', id: ed.dataset.edge }); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.node) { e.preventDefault(); closeDetail(); } });
  subscribe(renderDrawer);
}

// Delegated opener for any element carrying data-open (overview rows, notice buttons) and memory chips.
export function bindOpeners(root) {
  root.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'), mm = e.target.closest('[data-memory]');
    if (mm) { openDetail({ kind: 'memory', id: mm.dataset.memory }); return; }
    if (o) { try { openDetail(JSON.parse(o.dataset.open)); } catch { /* ignore a malformed attribute */ } }
  });
}
