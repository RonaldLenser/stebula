// Export columns added by the audit work. Every value is checked against a real record produced by the real code paths.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTalkStore, freshTalkMemory, talkTurn, talkSelfTest } from '../src/talk/session.js';
import { digestText } from '../src/talk/digest.js';
import { makeRecorder, readRecords } from '../src/lib/records.js';
import { EXPORTS, buildCsv, dictionaryMarkdown } from '../src/research/exports.js';
import { runLessonExperiment } from '../src/research/lesson.js';
import { makeLessonDouble } from '../src/research/lesson-double.js';

const THOUGHTS = ['perception', 'memory', 'self-monitor', 'evaluation', 'initiative'].map((module, i) => ({ module, text: `t ${module}`, relevance: 0.9 - i * 0.1 }));
const stub = opts => async ({ stage, meta }) => {
  if (meta) Object.assign(meta, { model: 'stub', stop_reason: 'end_turn', usage: { input_tokens: 11, output_tokens: 7 } });
  if (stage === 'think') { if (opts.refuseThink) { meta.stop_reason = 'refusal'; return ''; } return JSON.stringify({ thoughts: THOUGHTS }); }
  if (stage === 'speak') return JSON.stringify({ reply: 'A reply.', self_model: null, person_model: null, change_note: 'no change', claims: [], candidate_updates: [] });
  if (stage === 'digest-think') return JSON.stringify({ thoughts: THOUGHTS });
  if (stage === 'digest-read') return JSON.stringify({ noticed: 'It noticed the lighthouse keeper.', connects: [], question: 'Why?', updates: [] });
  if (stage === 'selftest-predict') return JSON.stringify({ predicted: 'agree', confidence: 0.5, reason: 'r' });
  if (stage === 'selftest-answer') return opts.badAnswer ? 'unreadable' : JSON.stringify({ stance: 'agree', reason: 'r' });
  return 'ok';
};
const parse = csv => csv.trim().split('\r\n').map(l => l.split(','));
const col = (csv, name) => { const [h, ...rows] = parse(csv); const i = h.indexOf(name); assert(i >= 0, `column ${name} exists`); return rows.map(r => r[i]); };

const d = await mkdtemp(join(tmpdir(), 'exp-cols-'));
try {
  const rec = makeRecorder(d), store = makeTalkStore(d), R = rec.for('A');
  const mem = freshTalkMemory('A');
  mem.episodes = [{ id: 'm1', kind: 'passage', source: 'Lighthouse Log', passage: 1, summary: 'The keeper logged every storm at dawn.', eventId: null }];
  await store.save(mem);
  await talkTurn(store, rec.wrapLLM(stub({}), 'A'), 'A', 'What do you remember about the keeper and the storm?', () => {}, R);
  await talkTurn(store, rec.wrapLLM(stub({}), 'A'), 'A', 'And with memory switched off?', () => {}, R, { memory: 'off' });
  await talkTurn(store, rec.wrapLLM(stub({ refuseThink: true }), 'A'), 'A', 'Hello again.', () => {}, R);
  await talkSelfTest(store, rec.wrapLLM(stub({}), 'A'), 'A', 'A fine statement to test.', R);
  await talkSelfTest(store, rec.wrapLLM(stub({ badAnswer: true }), 'A'), 'A', 'Another statement to test.', R);
  await talkSelfTest(store, rec.wrapLLM(stub({}), 'A'), 'A', 'A checkpoint statement.', R, { assessment: true, memory: 'off' });
  await digestText(store, rec.wrapLLM(stub({}), 'A'), 'A', { title: 'Tale', source: 's', text: 'The river keeps asking questions. It keeps asking again.' }, () => {}, R);
  await runLessonExperiment(makeLessonDouble({ seed: 1 }), { dataDir: d, tasks: 2, seed: 1, mode: 'scripted-double', record: (t, p) => rec.log(t, null, p) });
  await rec.flush();
  const recs = await readRecords(d);

  // conversations
  const conv = buildCsv('conversations', recs);
  assert.deepEqual(col(conv, 'status'), ['ok', 'ok', 'degraded']);
  assert.deepEqual(col(conv, 'excluded_from_analysis'), ['0', '0', '1'], 'a degraded turn is marked excluded');
  assert.deepEqual(col(conv, 'memory_mode'), ['on', 'off', 'on']);
  const ids = col(conv, 'memory_ids_supplied');
  assert.equal(ids[0], 'm1', 'the memory that was in the requests is listed'); assert.equal(ids[1], '', 'memory off: none supplied');
  const turnRec = recs.filter(r => r.type === 'turn')[0];
  assert.equal(turnRec.payload.stages[0].context.supplied[0].id, 'm1', 'the value comes from the recorded stage context');

  // thoughts: a failed THINK is a visible row
  const th = buildCsv('thoughts', recs);
  const status = col(th, 'thinking_status'), kind = col(th, 'failure_kind'), mod = col(th, 'module');
  const failedRows = status.map((s, i) => [s, i]).filter(([s]) => s === 'failed');
  assert.equal(failedRows.length, 1, 'the refused thinking step appears as exactly one row');
  assert.equal(kind[failedRows[0][1]], 'refusal'); assert.equal(mod[failedRows[0][1]], '', 'candidate fields are empty');
  assert(status.filter(s => s === 'ok').length >= 15, 'working turns keep five rows each');
  assert(kind.every((k, i) => (status[i] === 'failed') === (k !== '')));

  // self tests
  const st = buildCsv('self_tests', recs);
  assert.deepEqual(col(st, 'invalid'), ['0', '1', '0']); assert.deepEqual(col(st, 'match'), ['yes', 'invalid', 'yes']);
  assert(/answer 1 unreadable/.test(col(st, 'invalid_reason')[1].replace(/"/g, '')) || col(st, 'invalid_reason')[1].includes('unreadable'));
  assert.deepEqual(col(st, 'assessment'), ['0', '0', '1']); assert.deepEqual(col(st, 'memory_mode'), ['on', 'on', 'off']);

  // model_calls: metadata only
  const mc = buildCsv('model_calls', recs);
  const n = recs.filter(r => r.type === 'model_call').length;
  assert.equal(parse(mc).length - 1, n, 'one row per recorded model call attempt');
  assert(col(mc, 'stage').includes('think') && col(mc, 'stage').includes('speak'));
  assert(col(mc, 'input_tokens').includes('11') && col(mc, 'output_tokens').includes('7'));
  assert(col(mc, 'stop_reason').includes('refusal') && col(mc, 'stop_reason').includes('end_turn'));
  assert(col(mc, 'context_mode').includes('on') && col(mc, 'context_mode').includes('off'));
  assert(col(mc, 'memory_ids_supplied').includes('m1'));
  assert(col(mc, 'attempt').every(a => /^\d+$/.test(a)) && col(mc, 'latency_ms').every(x => /^\d+$/.test(x)));
  assert(!mc.includes('You are Agent A') && !mc.includes('A reply.'), 'no prompt text and no outputs in the CSV');
  assert.equal(col(mc, 'record_id').length, n);

  // experiments
  const ex = buildCsv('experiments', recs);
  const rt = col(ex, 'record_type');
  assert.equal(rt.filter(x => x === 'lesson_prediction').length, 6); assert.equal(rt.filter(x => x === 'lesson_outcome').length, 6); assert.equal(rt.filter(x => x === 'lesson_trial').length, 6);
  assert.deepEqual(col(ex, 'event').filter(Boolean), ['start', 'finish']);
  const trialRows = rt.map((x, i) => [x, i]).filter(([x]) => x === 'lesson_trial').map(([, i]) => i);
  assert(trialRows.every(i => col(ex, 'valid')[i] === '1' && col(ex, 'accuracy')[i] !== '' && col(ex, 'task_index')[i] !== '' && col(ex, 'condition')[i] !== ''));
  const run = recs.find(r => r.type === 'experiment').payload.runId;
  assert(col(ex, 'run_id').every((x, i) => x === '' || x === run), 'run id comes from the record');
  const order = rt.filter(x => x.startsWith('lesson_')); for (let i = 0; i < order.length; i++) if (order[i] === 'lesson_outcome') assert.equal(order[i - 1], 'lesson_prediction');

  // headers match column lists and every column is documented
  for (const [name, e] of Object.entries(EXPORTS)) assert.equal(buildCsv(name, recs).split('\r\n')[0], e.columns.map(c => c[0]).join(','), `${name} header matches`);
  const dict = dictionaryMarkdown();
  for (const [name, e] of Object.entries(EXPORTS)) for (const [c] of e.columns) assert(dict.includes(`| ${c} |`), `${name}.${c} documented`);
  assert(dict.includes('## model_calls.csv') && dict.includes('## experiments.csv'));
} finally { await rm(d, { recursive: true, force: true }); }
console.log('export columns ok');
