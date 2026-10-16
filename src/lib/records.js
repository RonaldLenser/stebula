// Complete, append-only research record: one JSON object per line in data/records/YYYY-MM-DD.jsonl.
// Nothing is ever rewritten or deleted here. Resets archive the old memory file and add a record saying so.
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const KEY = /sk-ant-[A-Za-z0-9_-]{8,}/g;   // an Anthropic key never reaches disk, even if it somehow lands in a payload
export const scrub = s => s.replace(KEY, '[redacted-key]');

export function makeRecorder(dir, { session = `s${Date.now().toString(36)}` } = {}) {
  const root = path.join(dir, 'records');
  let n = 0, chain = Promise.resolve();
  const write = (type, agent, payload, extra = {}) => {
    const at = new Date().toISOString();
    const rec = { id: `r${Date.parse(at).toString(36)}-${(++n).toString(36)}`, at, agent: agent ?? null, session, type, payload: payload ?? {}, ...extra };
    const line = scrub(JSON.stringify(rec)) + '\n';
    chain = chain.then(async () => { await mkdir(root, { recursive: true }); await appendFile(path.join(root, `${at.slice(0, 10)}.jsonl`), line); }).catch(() => {});
    return rec.id;
  };
  return {
    session, root,
    log: write,
    // A recorder bound to one agent, in the shape the Talk code expects: record(type, payload).
    for: agent => (type, payload) => write(type, agent, payload),
    // Wrap a model call so every call is recorded with its stage, full prompt, raw output, model, latency and usage.
    wrapLLM(llm, agent) {
      return async call => {
        const meta = {}, t0 = Date.now();
        const { stage, ...rest } = call;
        try {
          const out = await llm({ ...rest, meta });
          write('model_call', agent, { stage: stage || 'unlabeled', system: rest.system, messages: rest.messages || [{ role: 'user', content: rest.user }], max_tokens: rest.max_tokens ?? null, output: out, model: meta.model ?? null, stop_reason: meta.stop_reason ?? null, usage: meta.usage ?? null, latency_ms: Date.now() - t0 });
          return out;
        } catch (e) {
          write('model_call', agent, { stage: stage || 'unlabeled', system: rest.system, messages: rest.messages || [{ role: 'user', content: rest.user }], error: e.message, latency_ms: Date.now() - t0 });
          throw e;
        }
      };
    },
    flush: () => chain,
  };
}

export async function readRecords(dir) {
  const root = path.join(dir, 'records');
  let files = [];
  try { files = (await readdir(root)).filter(f => f.endsWith('.jsonl')).sort(); } catch { return []; }
  const out = [];
  for (const f of files) for (const line of (await readFile(path.join(root, f), 'utf8')).split('\n')) { if (line.trim()) { try { out.push(JSON.parse(line)); } catch { /* skip a torn line */ } } }
  return out;
}
