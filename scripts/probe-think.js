// A small, deliberate live check of the proposal step. It sends the SAME request twice to the real model:
// once with the earlier prompt wording ("private thinking stage") and once with the current wording, then reports
// only the stop reason, output tokens and whether the answer passed validation. It never prints the key or the
// model's text. It costs real credit (2 calls by default), so it refuses to run without --yes.
//   node scripts/probe-think.js --yes            (add --runs 3 for three pairs)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { makeNodeLLM } from '../src/agents/transport-node.js';
import { runStage } from '../src/lib/stage.js';
import { thinkSystem, THINK_TAIL } from '../src/talk/prompts.js';
import { buildContext } from '../src/talk/context.js';
import { freshAffect } from '../src/talk/workspace.js';
import { freshTalkMemory } from '../src/talk/session.js';
import { SCHEMAS, VALIDATORS } from '../src/talk/schemas.js';

loadEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
if (!process.argv.includes('--yes')) { console.log('This makes real model calls (2 per run) and costs credit. Re-run with --yes to proceed.'); process.exit(0); }
if (!process.env.ANTHROPIC_API_KEY) { console.log('No ANTHROPIC_API_KEY in .env. Nothing was sent.'); process.exit(0); }
const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 1;

const mem = freshTalkMemory('A');
const current = thinkSystem(mem, freshAffect(), buildContext(mem));
const earlier = current
  .replace(/This is the proposal stage\.[^\n]*/, "This is your private thinking stage. Produce one candidate thought from each of these processes, reacting to the person's latest message:")
  .replace(/Rate each proposal's relevance[^\n]*/, "Rate each thought's relevance from 0 to 1. Only two will reach your attention. The rest are dropped and you will not have them when you speak.");
const tail = THINK_TAIL.replace('Write the five proposals', 'Produce your candidate thoughts');
const llm = makeNodeLLM({ log: () => {} });
const variants = [['earlier wording', earlier, tail], ['current wording', current, THINK_TAIL]];
for (let i = 1; i <= runs; i++) for (const [name, system, t] of variants) {
  const r = await runStage(llm, { stage: 'think', system, messages: [{ role: 'user', content: `Lets try a test${t}` }], max_tokens: 900, schema: SCHEMAS.think, validate: VALIDATORS.think, retries: 0 });
  const a = r.attempts[0];
  console.log(`run ${i} ${name}: ${r.ok ? 'passed validation' : `failed (${r.failure.kind})`}; stop_reason ${a.stop_reason}; output tokens ${a.usage?.output_tokens ?? '?'}`);
}
