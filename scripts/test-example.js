// The committed example fixture is real session output from a deterministic stub, and is labelled as scripted.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildExample, EXAMPLE_LABEL } from './make-example.js';
import { norm } from '../src/talk/personality.js';

const committed = JSON.parse(await readFile(new URL('../examples/observe-example.json', import.meta.url), 'utf8'));
const fresh = await buildExample();

for (const [name, ex] of [['committed', committed], ['regenerated', fresh]]) {
  assert.equal(ex.scripted, true, `${name}: marked scripted`);
  assert.equal(ex.label, EXAMPLE_LABEL); assert.equal(ex.agent, 'A');
  const m = ex.mem;
  assert.equal(m.agent, 'A'); assert.equal(m.format, 'threshold-talk/2');
  assert(m.episodes.length >= 2 && m.episodes.every(e => /^m\d+$/.test(e.id)), `${name}: episode ids`);
  const deg = m.archive.filter(x => x.role === 'assistant' && x.degraded);
  assert.equal(deg.length, 1, `${name}: one degraded turn`);
  assert.equal(deg[0].monologue.stages.find(s => s.stage === 'think').failure.kind, 'refusal');
  assert.equal(deg[0].monologue.candidates.length, 0);
  assert(m.archive.filter(x => x.role === 'assistant' && x.monologue && !x.degraded).length >= 2, `${name}: at least two normal turns`);
  assert(m.revisions.length >= 1, `${name}: a self-model revision`);
  assert(m.selfTests.some(t => t.match === 'invalid' && t.invalid), `${name}: an invalid self-test`);
  assert(m.selfTests.some(t => t.match !== 'invalid'), `${name}: a valid self-test`);
  assert(m.archive.some(x => x.monologue?.context?.speak?.supplied?.length), `${name}: a turn records the memories supplied to it`);
  // every personality quote appears verbatim (after normalization) in the text its event came from
  assert(m.personality.log.length >= 1);
  for (const e of m.personality.log) {
    const ev = m.personality.events.find(x => x.id === e.eventId);
    const turn = ev.sourceType === 'talk' ? ev.ref.turn : null;
    const source = ev.sourceType === 'talk'
      ? m.archive.filter(x => x.turn === turn).map(x => x.text).join('\n')
      : m.episodes.map(x => x.excerpt).join('\n');
    assert(` ${norm(source)} `.includes(` ${norm(e.quote)} `), `${name}: quote "${e.quote}" is verbatim in its source`);
    assert(e.quotePresent === true && e.supportReview === 'unreviewed');
  }
}
assert.equal(fresh.mem.turns, committed.mem.turns); assert.equal(fresh.mem.episodes.length, committed.mem.episodes.length);
assert.deepEqual(fresh.mem.selfTests.map(t => t.match), committed.mem.selfTests.map(t => t.match), 'the committed fixture matches what the code produces now');
console.log('example fixture ok');
