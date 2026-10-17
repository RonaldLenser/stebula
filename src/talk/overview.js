// The compact overview of one interaction: three questions, one notice. Pure functions over the process model,
// so every sentence is derived from recorded state and nothing here calls a model.
//   What went into this response?   What did it consider?   What changed afterward?
// The agent's reply is not repeated here: it is shown once, in the conversation.
import { ROLE_NAME } from './process.js';

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}...` : s; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// What went wrong at the proposal step, in words a visitor can act on. Each failure kind is its own sentence.
export const FAILURE_WORDS = {
  refusal: 'was ended by the model provider with a refusal',
  malformed: 'returned output the application could not read',
  schema: 'returned an answer in the wrong shape',
  empty: 'returned no text',
  truncation: 'was cut off before it finished',
  transport: 'could not reach the model service',
  timeout: 'took too long to answer',
};

// One notice for the whole interaction, or null when every stage completed.
export function noticeFor(model) {
  const n = model.nodes;
  if (model.overall.state === 'save-failed') return { level: 'bad', text: 'The reply was written but could not be saved. Nothing from this turn was stored.', open: { kind: 'node', id: 'changes' } };
  if (model.overall.state === 'incomplete') {
    if (n.proposals.status === 'failed') {
      const k = n.proposals.failure?.kind, why = FAILURE_WORDS[k] || 'failed';
      return { level: 'warn', text: `No proposals were recorded: the proposal step ${why}. The reply was written without them, and nothing from this turn changed its memory.`, open: { kind: 'node', id: 'proposals' }, kind: k || null };
    }
    return { level: 'warn', text: 'Part of this turn was recovered from cut-off output. Nothing from it changed the agent\'s memory.', open: { kind: 'node', id: 'reply' } };
  }
  if (model.overall.state === 'unrecorded' && n.noticed.status === 'done') return { level: 'info', text: 'This turn was saved before its process was recorded, so only the conversation is available.', open: null };
  return null;
}

export function overviewModel(model) {
  const n = model.nodes;
  const empty = !model.live && n.noticed.status !== 'done';
  if (empty) return { empty: true, notice: null, inputs: [], considered: null, changed: null };

  // ---- 1. what went into this response ----
  const mem = n.memories, c = mem.ctx.speak || mem.ctx.think, sup = mem.items.length;
  let context;
  if (mem.status === 'missing') context = { value: 'Not recorded for this turn.', state: 'missing' };
  else if (mem.status === 'waiting') context = { value: 'Recorded when the turn is saved.', state: 'waiting' };
  else if (c?.mode === 'off') context = { value: 'Memory was switched off. Nothing stored was supplied.', state: 'off' };
  else {
    const matched = c?.matched;
    const base = matched == null ? (sup ? `${plural(sup, 'stored reading')} supplied (how many matched was not recorded)` : 'No stored reading was supplied')
      : matched === 0 ? 'No stored reading matched this message'
        : `${matched} matched, ${sup} supplied${matched > sup ? ` (${matched - sup} left out by the size limit)` : ''}`;
    context = { value: `${base}. Also supplied: its self-description and its note about the person.`, state: sup ? 'supplied' : 'none' };
  }
  const pr = n.priorities.items, open = pr[1], carried = pr[2];
  const memOn = c?.mode === 'on';
  const bits = [`configured stance`, memOn && open.recorded ? plural(open.list.length, 'open question of its own', 'open questions of its own') : null, carried.recorded && carried.list.length ? `${carried.list.length} item${carried.list.length === 1 ? '' : 's'} carried over from last turn` : null].filter(Boolean);
  const aff = n.signals.items;
  const won = n.selected.winners;
  const inputs = [
    { id: 'noticed', label: 'Your message', value: `"${clip(n.noticed.detail, 90)}"`, to: 'proposals and reply', open: { kind: 'node', id: 'noticed' } },
    { id: 'memories', label: 'Stored context', ...context, to: 'proposals and reply', open: { kind: 'node', id: 'memories' } },
    { id: 'priorities', label: 'Instructions and priorities', value: `${bits.join(', ')}, and the fixed honesty rules.`, to: 'proposals and reply', open: { kind: 'node', id: 'priorities' } },
    { id: 'signals', label: 'Conversation signals', value: aff.length ? `surprise ${aff[0].value}, conflict ${aff[1].value}, curiosity ${aff[2].value}. Computed numbers, not feelings.` : (n.signals.status === 'missing' ? 'Not recorded for this turn.' : 'Not measured yet.'), to: 'proposals only', open: { kind: 'node', id: 'signals' } },
    { id: 'selected', label: 'Selected proposals', value: won.length ? `${won.length} of ${n.proposals.candidates.length} proposals were given to the reply step.` : n.selected.status === 'skipped' ? 'None. The reply was written without proposals.' : n.selected.status === 'waiting' ? 'Not reached yet.' : 'None recorded.', to: 'reply', open: { kind: 'node', id: 'selected' } },
  ];

  // ---- 2. what it considered ----
  const p = n.proposals;
  const considered = p.candidates.length
    ? { state: 'recorded', selected: won.map(w => ({ module: w.module, role: ROLE_NAME[w.module] || w.module, text: clip(w.text, 140) })), dropped: p.candidates.length - won.length, total: p.candidates.length }
    : p.status === 'active' ? { state: 'active', text: 'The proposal step is running.' }
      : p.status === 'waiting' ? { state: 'waiting', text: 'Not reached yet.' }
        : { state: 'none', text: 'No proposals were recorded.' };

  // ---- 3. what changed afterward ----
  const ch = n.changes, rev = ch.revision;
  const cats = [['beliefs', 'Believes'], ['uncertainties', 'Unsure about'], ['openQuestions', 'Wants to pursue']];
  const diffs = rev ? cats.map(([k, label]) => ({ label, added: (rev.after[k] || []).filter(x => !(rev.before[k] || []).includes(x)), removed: (rev.before[k] || []).filter(x => !(rev.after[k] || []).includes(x)) })).filter(d => d.added.length || d.removed.length) : [];
  let changed;
  if (ch.status === 'failed') changed = { state: 'failed', headline: 'Saving failed. Nothing from this turn was stored.' };
  else if (ch.status === 'skipped') changed = { state: 'skipped', headline: 'No memory changes were made, because this turn was incomplete.' };
  else if (ch.status === 'missing') changed = { state: 'unavailable', headline: 'The record of what changed is unavailable for this turn.' };
  else if (ch.status === 'waiting') changed = { state: 'pending', headline: 'Saved when the reply is done.' };
  else if (ch.status === 'done') changed = { state: 'saved', headline: 'Saved to its memory:', diffs, evidence: ch.evidence.map(e => `${e.direction === 'supports' ? 'For' : 'Against'} "${e.name}" (${e.kind})`), reports: ch.reports.length, note: rev ? `Its own stated reason: ${clip(rev.note, 160)}` : '' };
  else changed = { state: 'unchanged', headline: 'Nothing was saved or changed after this response.', note: 'Only the conversation record was added. Its self-description, evidence and notes were not touched.' };

  return { empty: false, notice: noticeFor(model), inputs, considered, changed, turn: model.turn, live: model.live };
}
