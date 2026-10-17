// Builds examples/observe-example.json: a real Talk memory object produced by running the real session code
// against a deterministic stub. It is a SCRIPTED fixture for the Observe view's empty state and for public replay.
// It is not a conversation with a model and says nothing about any model. Run: npm run example
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTalkStore, talkTurn, talkSelfTest } from '../src/talk/session.js';
import { digestText } from '../src/talk/digest.js';
import { makeRecorder } from '../src/lib/records.js';
import { codeRevision } from '../src/lib/revision.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXAMPLE_LABEL = 'Scripted example. Produced by a deterministic test stub, not a model.';
export const READINGS = [
  { title: 'The Lighthouse Log', text: 'A lighthouse keeper logged the weather every hour for thirty years. The entries he trusted least were the ones he wrote when he was sure.' },
  { title: 'The River Bridge', text: 'The village bridge was rebuilt twice after floods. The second time, a young engineer asked why the old bridge had failed before she drew anything.' },
];
const THOUGHTS = [
  ['perception', 'They ask what I remember and how I would know.', 0.8],
  ['memory', 'The lighthouse keeper log is relevant here.', 0.7],
  ['self-monitor', 'I only know what is in my memory file.', 0.5],
  ['evaluation', 'A confident entry is not the same as a correct one.', 0.45],
  ['initiative', 'Ask what would count as checking a belief.', 0.3],
].map(([module, text, relevance]) => ({ module, text, relevance }));

// Deterministic stub. It reads only the stage name and the user text, like a model would read its prompt.
function stub({ refuseThink = false, badAnswer = false } = {}) {
  return async ({ stage, messages, user, meta }) => {
    if (meta) Object.assign(meta, { model: 'scripted-stub', stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 40 } });
    const text = (messages || [{ content: user }]).map(m => m.content).join('\n');
    if (stage === 'think' || stage === 'digest-think') { if (refuseThink) { Object.assign(meta, { stop_reason: 'refusal', usage: { input_tokens: 100, output_tokens: 0 } }); return ''; } return JSON.stringify({ thoughts: THOUGHTS }); }
    if (stage === 'digest-read') {
      const keeper = /lighthouse/i.test(text);
      return JSON.stringify({ noticed: keeper ? 'Sure entries were the least reliable ones.' : 'Asking why a thing failed came before rebuilding it.', connects: keeper ? [] : ['m1'], question: keeper ? 'How would I notice my own overconfidence?' : 'What is my version of walking the river?', updates: [] });
    }
    if (stage === 'speak') {
      if (/What do you remember/.test(text)) return JSON.stringify({ reply: 'I remember the lighthouse keeper. I try to ask before I assume, because sure entries were his weakest.', self_model: { beliefs: ['My memory is a file I am shown each turn.'], uncertainties: ['Whether confidence tracks correctness for me.'], openQuestions: ['What would count as checking one of my beliefs?'] }, person_model: 'Curious about how I know things.', change_note: 'Added a belief about my memory and an uncertainty about confidence.', claims: [{ text: 'My memory is a file.', kind: 'behavioral' }], candidate_updates: [{ kind: 'trait', name: 'asks before assuming', direction: 'supports', evidence_quote: 'ask before I assume' }] });
      return JSON.stringify({ reply: 'Hello. What would you like to look at?', self_model: null, person_model: null, change_note: 'no change', claims: [], candidate_updates: [] });
    }
    if (stage === 'selftest-predict') return JSON.stringify({ predicted: 'agree', confidence: 0.6, reason: 'It matches my stored beliefs.' });
    if (stage === 'selftest-answer') return badAnswer ? 'I would rather not say.' : JSON.stringify({ stance: 'agree', reason: 'Consistent with my memory.' });
    return 'Folded.';
  };
}

// Returns the example object. Uses a temp folder for the store and the record; nothing is written under data/.
export async function buildExample() {
  const dir = await mkdtemp(path.join(tmpdir(), 'stebula-example-'));
  try {
    const store = makeTalkStore(dir), rec = makeRecorder(dir), R = rec.for('A');
    const llm = o => rec.wrapLLM(stub(o), 'A');
    for (const r of READINGS) await digestText(store, llm(), 'A', { title: r.title, source: 'scripted example', text: r.text }, () => {}, R);
    await talkTurn(store, llm(), 'A', 'What do you remember about the lighthouse keeper?', () => {}, R);
    await talkTurn(store, llm(), 'A', 'Hello again.', () => {}, R);
    await talkTurn(store, llm({ refuseThink: true }), 'A', 'Hello once more.', () => {}, R);   // THINK refused: a degraded turn
    await talkSelfTest(store, llm(), 'A', 'My memory is a file I am shown each turn.', R);
    await talkSelfTest(store, llm({ badAnswer: true }), 'A', 'An honest I do not know beats a confident guess.', R);   // unreadable answer: invalid
    await rec.flush();
    const mem = await store.load('A');
    return { scripted: true, label: EXAMPLE_LABEL, generatedAt: new Date().toISOString(), revision: codeRevision(ROOT), agent: 'A', mem };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ex = await buildExample();
  await mkdir(path.join(ROOT, 'examples'), { recursive: true });
  await writeFile(path.join(ROOT, 'examples', 'observe-example.json'), JSON.stringify(ex, null, 1) + '\n');
  console.log(`wrote examples/observe-example.json (${ex.mem.turns} turns, ${ex.mem.episodes.length} memories, ${ex.mem.selfTests.length} self-tests). ${EXAMPLE_LABEL}`);
}
