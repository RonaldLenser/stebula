// State shared by the Agent and History views: which agent, its stored memory, and which moment is selected.
// One selection drives the conversation, the overview and the detail drawer, so they never disagree about the turn.
import { api, config, $ } from '/core.js';
import { turnList } from '/src/talk/process.js';

export const S = {
  agent: 'A', mem: null, error: null, readonly: false, example: null, exampleAvailable: false,
  sel: null,        // selected stored turn, or null for the latest
  node: null,       // what the detail drawer shows: { kind: 'node'|'edge'|'proposal'|'memory'|'diagram', id }, or null when closed
  stack: [],        // where "Back" in the drawer goes
  opener: null,     // the control to return focus to when the drawer closes
  step: null,       // replay step index inside the diagram, or null to show the whole turn
  live: null, failedTurn: null, busy: null, pending: null, job: null,
  loadSeq: 0,       // guards against a slow response for one agent landing after the person switched agents
};
// `about` paraphrases the stance configured in src/agents/prompts.js. The exact configured text is shown in the details.
export const AGENTS = {
  A: { name: 'Agent A', role: 'empiricist', about: 'Trusts regularities in observed data and prefers the simplest rule that fits them.' },
  B: { name: 'Agent B', role: 'analogist', about: 'Reasons by analogy: asks what a case resembles and borrows structure from similar problems.' },
};
export const agentName = a => `${AGENTS[a]?.name ?? `Agent ${a}`} (${AGENTS[a]?.role ?? 'unknown role'})`;

const subs = new Set();
export const subscribe = fn => { subs.add(fn); return () => subs.delete(fn); };
export const notify = () => { for (const fn of subs) fn(); };

export const turns = () => (S.mem ? turnList(S.mem) : []);
export const latest = () => turns().at(-1) ?? null;
export const showingLive = () => !!(S.live || S.failedTurn);
export const viewTurn = () => (showingLive() ? null : S.sel ?? latest());
export const isHistory = () => !showingLive() && S.sel != null && S.sel !== latest();

// Choosing a turn never opens the drawer, and an open drawer stays open on the new turn.
export function selectTurn(t) {
  S.sel = t == null || t === latest() ? null : t; S.step = null; S.failedTurn = null;
  notify();
}

// ---- the detail drawer ----
export function openDetail(sel) {
  if (S.node) S.stack.push(S.node); else { const el = document.activeElement; S.opener = { el, key: el?.dataset?.open ?? null }; }
  S.node = sel; notify();
}
export function backDetail() { S.node = S.stack.pop() ?? null; notify(); if (!S.node) restoreFocus(); }
export function closeDetail() { S.node = null; S.stack = []; notify(); restoreFocus(); }
// The opener may have been redrawn while the drawer was open, so find it again by what it opened.
function restoreFocus() {
  const o = S.opener; S.opener = null; if (!o) return;
  let el = o.el && document.contains(o.el) ? o.el : null;
  if (!el && o.key) el = [...document.querySelectorAll('[data-open]')].find(e => e.dataset.open === o.key) ?? null;
  el?.focus();
}

export function syncRecorder(h) { const chip = $('#recChip'); if (chip) chip.hidden = !h || h.ok !== false; }

export async function loadExample(auto = false) {
  try { const ex = await api('/api/example'); S.example = ex; S.mem = ex.mem; S.agent = ex.mem.agent || S.agent; S.readonly = true; S.sel = null; S.node = null; S.stack = []; S.step = null; S.error = null; }
  catch { if (!auto) S.error = { error: 'No recorded example is bundled with this copy.' }; }
  notify();
}

// Loads one agent's memory. A response for an agent that is no longer selected is dropped, so records never mix.
export async function loadState() {
  if (config.value?.public) return loadExample(true);
  const agent = S.agent, seq = ++S.loadSeq;
  try {
    const j = await api(`/api/talk/state?agent=${agent}`);
    if (seq !== S.loadSeq || agent !== S.agent) return;
    S.mem = j.mem; S.error = null; S.readonly = false; S.example = null; syncRecorder(j.recorder);
  } catch (e) { if (seq === S.loadSeq && agent === S.agent) S.error = { ...e.info, error: e.message, kind: e.info?.kind || 'request' }; }
  notify();
}
export function switchAgent(a) {
  if (a === S.agent) return;
  S.agent = a; S.mem = null; S.sel = null; S.node = null; S.stack = []; S.step = null; S.error = null; S.live = null; S.failedTurn = null;
  notify(); return loadState();
}
export async function refreshMem() {
  const agent = S.agent;
  const j = await api(`/api/talk/state?agent=${agent}`);
  if (agent === S.agent) S.mem = j.mem;
  return j;
}
