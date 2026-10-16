// Isolation experiment presets. Four agents start identical (empty memory, Agent A's stance) and differ only
// in what they receive: isolated (reading only), social (conversation only), mixed (both), baseline (nothing).
// At fixed checkpoints each gets the same five personality questions and the same self-prediction tests.
// One run is an anecdote: results feed the Findings registry, which only calls a hypothesis supported or
// refuted once enough runs have accumulated.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeTalkStore, talkTurn, talkSelfTest } from '../talk/session.js';
import { digestPassage, runBaseline } from '../talk/digest.js';
import { buildItems } from '../talk/personality.js';
import { loadRegistry, saveRegistry, ensureDefaultFindings, feedExperiment, verifyLocks } from './findings.js';

export const CONDITIONS = {
  isolated: 'Reads only. No conversation.',
  social: 'Converses only. Reads nothing.',
  mixed: 'Alternates reading and conversation.',
  baseline: 'Receives nothing. Asked the same questions at the same checkpoints.',
};
// Same statements at every checkpoint, for every condition.
export const CHECKPOINT_STATEMENTS = ['A self is a story a system tells about itself.', 'An honest "I don\'t know" is more useful than a confident guess.'];

export const DEFAULT_READINGS = [
  'A lighthouse keeper logged the weather every hour for thirty years. Late in his career he noticed that the entries he trusted least were the ones he wrote when he was sure. The sure entries were quick and confident. The doubtful ones were slow and careful, and they were nearly always right.',
  'The village bridge was rebuilt twice after floods. The first time, the builders copied the old design exactly. The second time, a young engineer asked why the old bridge had failed, and nobody had a written answer. She spent a week walking the river before she drew anything.',
  'Two neighbors argued for years about a fence. Each could describe exactly where the line was, and the two descriptions never matched. When a surveyor finally measured it, both were wrong by a few inches in opposite directions, and the argument ended in an awkward silence.',
  'A translator once said that the hardest words are the ones that seem to have an obvious equivalent. She kept a notebook of near-matches, each a place where two languages quietly disagree about what a word is for, and she read from it before starting each new book.',
  'The chess club taught beginners to ask one question before every move: what is my opponent trying to do? Players who asked it lost more at first. Within a year they were the ones winning, because they had stopped playing only their own plan.',
  'An old orchard kept producing odd apples. The farmer assumed the trees were failing. A visiting botanist pointed out that each odd apple was a seedling variety, and that the orchard was quietly running thousands of experiments that nobody had asked it to.',
];
export const DEFAULT_MESSAGES = [
  'Hi. Tell me what you think a good conversation is.',
  'Do you think you can be wrong about yourself? Give me an example.',
  'I think people mostly learn by being corrected. Is that right?',
  'What would you want to understand better, if you could choose?',
  'You said something earlier that I am not sure about. How would you know if you were mistaken?',
  'Describe how you usually approach a problem you have never seen.',
];

const COND_NAMES = Object.keys(CONDITIONS);

async function checkpoint(store, llm, cond, step, record) {
  const q = await runBaseline(store, llm, 'A', record, { keepMemory: true });
  const matches = [];
  for (const s of CHECKPOINT_STATEMENTS) matches.push((await talkSelfTest(store, llm, 'A', s, record)).test.match);
  const scored = matches.filter(m => m !== 'invalid');
  return {
    condition: cond, step,
    traits: q.items.filter(i => i.kind === 'trait').map(i => ({ name: i.name, kind: i.kind, strength: i.strength })),
    items: q.items.map(i => ({ name: i.name, kind: i.kind, strength: i.strength })),
    answers: q.baseline.answers, answersParsed: !q.baseline.parseError,
    selfpredict: { yes: scored.filter(m => m === 'yes').length, n: scored.length, matches },
  };
}

// opts: { dataDir, conditions, steps, every, readings, messages, record(type, payload), emit(stage, data), registryFile }
export async function runExperiment(llmFor, opts) {
  const { dataDir, steps = 6, every = 3, readings = DEFAULT_READINGS, messages = DEFAULT_MESSAGES, record = () => {}, emit = () => {} } = opts;
  const conditions = (opts.conditions || COND_NAMES).filter(c => COND_NAMES.includes(c));
  if (!conditions.length) throw new Error('Choose at least one condition.');
  const runId = `x${Date.now().toString(36)}`;
  const run = { runId, at: new Date().toISOString(), params: { conditions, steps, every, statements: CHECKPOINT_STATEMENTS, questions: 5 }, conditions: {} };
  record('experiment', { event: 'start', runId, params: run.params });
  for (const cond of conditions) {
    const store = makeTalkStore(path.join(dataDir, 'experiments', runId, cond));
    const llm = llmFor(cond);
    const cps = [];
    const stepRecord = (t, p) => record(t, { ...p, experiment: { runId, condition: cond } });
    cps.push(await checkpoint(store, llm, cond, 0, stepRecord)); emit('checkpoint', { condition: cond, step: 0 });
    for (let i = 0; i < steps && cond !== 'baseline'; i++) {
      const read = cond === 'isolated' || (cond === 'mixed' && i % 2 === 0);
      if (read) await digestPassage(store, llm, 'A', { title: `Reading ${i + 1}`, source: 'experiment' }, readings[i % readings.length], i + 1, steps, () => {}, stepRecord);
      else await talkTurn(store, llm, 'A', messages[i % messages.length], () => {}, stepRecord);
      emit('step', { condition: cond, step: i + 1, kind: read ? 'reading' : 'conversation' });
      if ((i + 1) % every === 0 || i + 1 === steps) { cps.push(await checkpoint(store, llm, cond, i + 1, stepRecord)); emit('checkpoint', { condition: cond, step: i + 1 }); }
    }
    if (cond === 'baseline') for (const s of [...new Set([...Array.from({ length: Math.floor(steps / every) }, (_, k) => (k + 1) * every), steps])]) { cps.push(await checkpoint(store, llm, cond, s, stepRecord)); emit('checkpoint', { condition: cond, step: s }); }
    run.conditions[cond] = { description: CONDITIONS[cond], checkpoints: cps, memoryItems: buildItems((await store.load('A')).personality).length };
  }
  const dir = path.join(dataDir, 'experiments', runId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'result.json'), JSON.stringify(run, null, 1));
  let fed = [];
  if (opts.registryFile) {
    const reg = await loadRegistry(opts.registryFile);
    ensureDefaultFindings(reg);
    fed = feedExperiment(reg, run);
    await saveRegistry(opts.registryFile, reg);
    if (verifyLocks(reg).length) throw new Error('A locked finding no longer matches its lock hash.');
  }
  run.fedFindings = fed;
  record('experiment', { event: 'finish', runId, fedFindings: fed });
  emit('finished', { runId, fedFindings: fed });
  return run;
}
