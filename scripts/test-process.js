// Tests for the process map and history views. These are the places where the interface could mislead:
// a missing record must not look like a result, a failed stage must not look like a success,
// history must come from history, and one agent's records must never show up in another's view.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processModel, historyMoments, stateAt, selfAt, activityLabel, turnList, agentMsg, STEPS, NODES, STATUS_TEXT } from '../src/talk/process.js';
import { applyStage, emptyBrain } from '../src/talk/brain.js';
import { makeTalkStore, talkTurn } from '../src/talk/session.js';
import { makeFakeLLM } from '../src/dev/fake-llm.js';

const fixture = JSON.parse(await readFile(new URL('../examples/observe-example.json', import.meta.url), 'utf8')).mem;
const clone = x => JSON.parse(JSON.stringify(x));
let n = 0; const ok = m => console.log(`ok ${++n}. ${m}`);

// 1. A complete turn: every stage has a status from the recorded state and the map is internally consistent.
{
  const m = processModel({ mem: fixture, turn: 1 });
  assert.equal(m.nodes.noticed.status, 'done'); assert.equal(m.nodes.proposals.status, 'done'); assert.equal(m.nodes.selected.status, 'done'); assert.equal(m.nodes.reply.status, 'done');
  assert.equal(m.nodes.selected.winners.length, 2); assert.equal(m.nodes.proposals.candidates.length, 5);
  assert.equal(m.overall.state, 'complete');
  const ids = new Set(Object.keys(m.nodes));
  for (const e of m.edges) assert(ids.has(e.from) && ids.has(e.to), `edge ${e.id} joins real nodes`);
  assert.deepEqual([...ids].sort(), NODES.map(x => x.id).sort());
  for (const s of Object.values(m.nodes)) assert(STATUS_TEXT[s.status], `status ${s.status} has plain text`);
  ok('a complete recorded turn maps every stage with a named status and edges that join real nodes');
}

// 2. The reply step's direct inputs are listed, including what it was NOT given.
{
  const m = processModel({ mem: fixture, turn: 1 }), r = m.nodes.reply;
  assert(r.inputs.some(i => i.label === 'Your message') && r.inputs.some(i => /Selected proposals \(2\)/.test(i.label)) && r.inputs.some(i => /Stored memory/.test(i.label)));
  assert(r.notGiven.some(x => /dropped/.test(x)) && r.notGiven.some(x => /signal/.test(x)));
  assert(m.edges.find(e => e.id === 'noticed-reply').kind === 'direct' && m.edges.find(e => e.id === 'memories-reply').kind === 'direct');
  ok('the reply step shows its direct inputs next to the selected proposals, and what it was not given');
}

// 3. A degraded turn (thinking failed, reply still written) never looks like a clean success.
{
  const t = turnList(fixture).find(x => agentMsg(fixture, x).degraded);
  assert(t, 'the fixture has a degraded turn');
  const m = processModel({ mem: fixture, turn: t });
  assert.equal(m.nodes.proposals.status, 'failed'); assert.equal(m.nodes.selected.status, 'skipped'); assert.equal(m.nodes.reply.status, 'partial'); assert.equal(m.nodes.changes.status, 'skipped');
  assert.equal(m.overall.state, 'incomplete'); assert.match(m.overall.text, /thinking step failed/);
  assert.equal(m.nodes.proposals.candidates.length, 0); assert.equal(m.nodes.selected.winners.length, 0);
  assert.equal(m.edges.find(e => e.id === 'selected-reply').given, false, 'no selection reached the reply');
  ok('a failed thinking step followed by a reply is shown as failed, skipped, and "completed, incomplete process"');
}

// 4. Missing records are "nothing recorded", never invented content. A turn from before recording has no values.
{
  const old = clone(fixture); delete agentMsg(old, 1).monologue;
  const m = processModel({ mem: old, turn: 1 });
  assert.equal(m.nodes.signals.status, 'missing'); assert.equal(m.nodes.proposals.status, 'missing'); assert.equal(m.nodes.selected.status, 'missing'); assert.equal(m.nodes.memories.status, 'missing');
  assert.equal(m.nodes.signals.items.length, 0); assert.equal(m.nodes.proposals.candidates.length, 0);
  assert.equal(m.overall.state, 'unrecorded'); assert.equal(m.nodes.noticed.status, 'done', 'what was said is still recorded');
  const gone = processModel({ mem: old, turn: 99 });
  assert.equal(gone.nodes.noticed.status, 'waiting'); assert.equal(gone.overall.state, 'unrecorded');
  ok('missing records show as "Nothing recorded" with no numbers, and an unknown turn selects nothing');
}

// 5. Memory states are different things: switched off, nothing relevant, and supplied.
{
  const off = clone(fixture), a = agentMsg(off, 1);
  for (const k of ['think', 'speak']) { a.monologue.context[k].mode = 'off'; a.monologue.context[k].supplied = []; }
  const mo = processModel({ mem: off, turn: 1 });
  assert.equal(mo.nodes.memories.status, 'none'); assert.match(mo.nodes.memories.summary, /switched off/); assert.equal(mo.edges.find(e => e.id === 'memories-reply').given, false); assert.equal(mo.nodes.memories.always.length, 0);
  const none = clone(fixture), b = agentMsg(none, 1);
  for (const k of ['think', 'speak']) { b.monologue.context[k].mode = 'on'; b.monologue.context[k].supplied = []; }
  const mn = processModel({ mem: none, turn: 1 });
  assert.equal(mn.nodes.memories.status, 'none'); assert.match(mn.nodes.memories.summary, /No stored reading matched/); assert.notEqual(mn.nodes.memories.summary, mo.nodes.memories.summary);
  assert(mn.nodes.memories.always.length > 0, 'with memory on, the self-description and notes are still supplied');
  const supplied = clone(fixture), c = agentMsg(supplied, 1);
  c.monologue.context.speak = { ...c.monologue.context.speak, mode: 'on', supplied: [{ id: 'm1', source: 'The Lighthouse Log', passage: 1, score: 0.4 }] };
  const ms = processModel({ mem: supplied, turn: 1 });
  assert.equal(ms.nodes.memories.status, 'done'); assert(ms.nodes.memories.items.some(i => i.id === 'm1' && i.to.includes('reply')));
  assert.match(mo.nodes.memories.window, /supplied either way/);
  ok('memory off, no relevant memory and supplied memories are three distinct states, and supplied is never called "caused"');
  assert.match(ms.nodes.memories.note, /does not show the memory caused/);
}

// 5b. Chip words say what happened, not just which bucket.
{
  const m = processModel({ mem: fixture, turn: 1 });
  assert.equal(m.nodes.changes.status === 'none' ? m.nodes.changes.label : 'Nothing changed', 'Nothing changed');
  const off = clone(fixture); for (const k of ['think', 'speak']) { agentMsg(off, 1).monologue.context[k].mode = 'off'; agentMsg(off, 1).monologue.context[k].supplied = []; }
  assert.equal(processModel({ mem: off, turn: 1 }).nodes.memories.label, 'Memory switched off');
  const none = clone(fixture); for (const k of ['think', 'speak']) { agentMsg(none, 1).monologue.context[k].mode = 'on'; agentMsg(none, 1).monologue.context[k].supplied = []; }
  assert.equal(processModel({ mem: none, turn: 1 }).nodes.memories.label, 'No relevant memory');
  assert(Object.values(m.nodes).every(n => n.label && n.short));
  ok('status chips use specific words: memory switched off, no relevant memory, nothing changed');
}

// 6. A live turn is "still processing" and unreached stages are "not reached", with no invented values.
{
  let s = applyStage(emptyBrain(), 'heard', { turn: 4, text: 'hello there' });
  let m = processModel({ mem: fixture, live: s });
  assert.equal(m.overall.state, 'processing'); assert.equal(m.nodes.noticed.status, 'done'); assert.equal(m.nodes.signals.status, 'waiting'); assert.equal(m.nodes.proposals.status, 'waiting'); assert.equal(m.nodes.reply.status, 'waiting');
  s = applyStage(s, 'affect', { before: fixture.affect, after: { surprise: 0, conflict: 0, curiosity: 0.5 }, causes: ['x'] });
  m = processModel({ mem: fixture, live: s });
  assert.equal(m.nodes.signals.status, 'done'); assert.equal(m.nodes.proposals.status, 'active'); assert.equal(m.nodes.selected.status, 'waiting'); assert.equal(m.nodes.proposals.candidates.length, 0);
  assert.equal(activityLabel({ live: s }), 'Generating proposals');
  s = applyStage(s, 'thoughts', { candidates: fixture.archive.find(x => x.monologue).monologue.candidates, status: 'ok' });
  s = applyStage(s, 'workspace', { winners: [] });
  m = processModel({ mem: fixture, live: s });
  assert.equal(m.nodes.proposals.status, 'done'); assert.equal(m.nodes.reply.status, 'active'); assert.equal(activityLabel({ live: s }), 'Writing a reply');
  ok('a live turn shows done, still processing and not reached, and the activity label follows what the stream reported');
}

// 7. The activity label never claims thinking between messages.
{
  assert.equal(activityLabel({}), 'Waiting for your message');
  assert.match(activityLabel({ readonly: true }), /Nothing is running/);
  assert.equal(activityLabel({ hasModel: false }), 'Idle. No model is connected');
  const all = ['idle', 'heard', 'affect', 'thoughts', 'workspace', 'speaking', 'done'].map(p => activityLabel({ live: { phase: p } }));
  assert(all.every(l => !/retriev|think(ing)? about|dream|ponder/i.test(l)), `labels only name stages the stream reports: ${all.join(' | ')}`);
  ok('activity labels only name stages the implementation exposes, and idle means idle');
}

// 8. History comes from history: the self-description at an earlier moment is the earlier one.
{
  const mem = clone(fixture);
  const revs = mem.revisions; assert(revs.length >= 1, 'the fixture changes its self-description at least once');
  const first = revs[0], before = selfAt(mem, new Date(Date.parse(first.at) - 5).toISOString());
  assert.deepEqual(before, first.before); assert.deepEqual(selfAt(mem, first.at), first.after);
  if (revs.length > 1) assert.notDeepEqual(selfAt(mem, first.at), selfAt(mem, revs.at(-1).at));
  const t1 = agentMsg(mem, 1).at, s1 = stateAt(mem, t1), sN = stateAt(mem, '9999');
  assert(s1.turns <= sN.turns && s1.readings.length <= sN.readings.length);
  assert(s1.gaps.some(g => /note about the person/.test(g)), 'what cannot be reconstructed is stated, not filled from the present');
  assert.deepEqual(s1.readings.map(e => e.id), mem.episodes.filter(e => e.kind !== 'summary' && e.at <= t1).map(e => e.id));
  const moments = historyMoments(mem);
  assert(moments.length > 3 && moments.every((x, i, a) => !i || a[i - 1].at <= x.at), 'moments are in recorded order');
  assert(moments.some(x => x.kind === 'turn') && moments.some(x => x.kind === 'reading'));
  ok('history uses the revision log and timestamps: earlier state is the earlier state, and gaps are stated');
}

// 9. Priorities state their sources and say when something is not recorded.
{
  const m = processModel({ mem: fixture, turn: 1 }), p = m.nodes.priorities;
  assert.equal(p.items.find(i => i.kind === 'stance').source.startsWith('Configured'), true);
  assert.equal(p.items.find(i => i.kind === 'carried').recorded, false, 'turn 1 has no previous turn to carry over');
  const m2 = processModel({ mem: fixture, turn: 2 });
  assert.equal(m2.nodes.priorities.items.find(i => i.kind === 'carried').recorded, true);
  assert.equal(m2.nodes.priorities.items.find(i => i.kind === 'carried').list.length, 2);
  assert.match(p.summary, /No separate goal list/);
  ok('priorities name their sources (configured, its own notes, last turn) and admit when nothing is recorded');
}

// 10. Real turns through the real session code: stage events are stamped, ids are stable, and two agents never mix.
{
  const dir = await mkdtemp(join(tmpdir(), 'proc-'));
  try {
    const store = makeTalkStore(dir), llm = makeFakeLLM(), seen = { A: [], B: [] };
    for (const [ag, text] of [['A', 'hello from A'], ['B', 'a different question for B?'], ['A', 'second thing for A']]) await talkTurn(store, llm, ag, text, (stage, d) => seen[ag].push(stage));
    const A = await store.load('A'), B = await store.load('B');
    assert.deepEqual(turnList(A), [1, 2]); assert.deepEqual(turnList(B), [1]);
    const mono = agentMsg(A, 1).monologue;
    assert.equal(mono.turnId, 'A-1'); assert.equal(agentMsg(B, 1).monologue.turnId, 'B-1');
    assert.deepEqual(mono.events.map(e => e.stage).slice(0, 5), ['heard', 'affect', 'thoughts', 'workspace', 'speaking']);
    assert(mono.events.every((e, i, a) => e.seq === i && (!i || a[i - 1].at <= e.at)), 'events are numbered and in time order');
    const mA = processModel({ mem: A, turn: 1 }), mB = processModel({ mem: B, turn: 1 });
    assert.match(mA.nodes.noticed.detail, /hello from A/); assert.match(mB.nodes.noticed.detail, /different question for B/);
    assert(!JSON.stringify(mA).includes('different question for B') && !JSON.stringify(mB).includes('hello from A'), 'no record crosses between agents');
    assert.equal(mA.agent, 'A'); assert.equal(mB.agent, 'B');
    assert.notEqual(mA.nodes.priorities.items[0].text, mB.nodes.priorities.items[0].text, 'each agent shows its own configured stance');
    assert.equal(processModel({ mem: A, turn: 2 }).nodes.priorities.items.find(i => i.kind === 'carried').recorded, true);
    ok('real turns record stamped stage events and a stable turn id, and agents A and B stay separate');
  } finally { await rm(dir, { recursive: true, force: true }); }
}

assert.equal(STEPS.length, 6); assert(STEPS.flatMap(s => s.reveals).sort().join() === NODES.map(x => x.id).sort().join(), 'every node is revealed by exactly one replay step');
ok('replay steps cover every node exactly once');
console.log(`process tests passed (${n})`);
