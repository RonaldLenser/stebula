// State shared by the Agent and History views: which agent, its stored memory, and which moment is selected.
// One selection drives the conversation, the process map and the inspector, so they never disagree about the turn.
import { api, config, $ } from '/core.js';
import { turnList } from '/src/talk/process.js';

export const S = {
  agent: 'A', mem: null, error: null, readonly: false, example: null, exampleAvailable: false,
  sel: null,        // selected stored turn, or null for the latest
  node: null,       // { kind: 'node'|'edge'|'proposal'|'memory', id }
  step: null,       // replay step index, or null to show the whole turn
  live: null, busy: null, pending: null, job: null,
  loadSeq: 0,       // guards against a slow response for one agent landing after the person switched agents
};
// `about` paraphrases the stance configured in src/agents/prompts.js. The exact configured text is shown in the inspector.
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
export const viewTurn = () => (S.live ? null : S.sel ?? latest());
export const isHistory = () => !S.live && S.sel != null && S.sel !== latest();

export function selectTurn(t, { node = undefined } = {}) {
  S.sel = t == null || t === latest() ? null : t; S.step = null;
  if (node !== undefined) S.node = node;
  notify();
}
export const selectNode = (sel, { turn } = {}) => { if (turn != null) S.sel = turn === latest() ? null : turn; S.node = sel; notify(); };

export function syncRecorder(h) { const chip = $('#recChip'); if (chip) chip.hidden = !h || h.ok !== false; }

export async function loadExample(auto = false) {
  try { const ex = await api('/api/example'); S.example = ex; S.mem = ex.mem; S.agent = ex.mem.agent || S.agent; S.readonly = true; S.sel = null; S.node = null; S.step = null; S.error = null; }
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
  S.agent = a; S.mem = null; S.sel = null; S.node = null; S.step = null; S.error = null; S.live = null;
  notify(); return loadState();
}
export async function refreshMem() {
  const agent = S.agent;
  const j = await api(`/api/talk/state?agent=${agent}`);
  if (agent === S.agent) S.mem = j.mem;
  return j;
}
