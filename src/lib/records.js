// Complete, append-only research record: one JSON object per line in data/records/YYYY-MM-DD.jsonl.
// Nothing is ever rewritten or deleted here. Resets archive the old memory file and add a record saying so.
// A failed append is never swallowed: the line is kept and retried, the failure is counted and printed, and
// health() says whether the record is complete so the app can refuse to claim it is.
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const KEY = /sk-ant-[A-Za-z0-9_-]{8,}/g;   // an Anthropic key never reaches disk, even if it somehow lands in a payload
export const scrub = s => s.replace(KEY, '[redacted-key]');

export function makeRecorder(dir, { session = `s${Date.now().toString(36)}`, revision = null, onFailure = e => console.error(`[recorder] could not write the research record: ${e.message}`) } = {}) {
  const root = path.join(dir, 'records');
  let n = 0, chain = Promise.resolve();
  const pending = [];                       // lines accepted but not yet on disk, oldest first
  const health = { written: 0, failedWrites: 0, lastError: null, lastErrorAt: null };
  const drain = async () => {
    while (pending.length) {
      const { file, line } = pending[0];
      await mkdir(root, { recursive: true });
      await appendFile(path.join(root, file), line);
      pending.shift(); health.written++;
    }
  };
  const write = (type, agent, payload, extra = {}) => {
    const at = new Date().toISOString();
    const rec = { id: `r${Date.parse(at).toString(36)}-${(++n).toString(36)}`, at, agent: agent ?? null, session, type, payload: payload ?? {}, ...extra };
    if (revision) rec.revision = revision;
    pending.push({ file: `${at.slice(0, 10)}.jsonl`, line: scrub(JSON.stringify(rec)) + '\n' });
    chain = chain.then(drain).catch(e => { health.failedWrites++; health.lastError = e.message; health.lastErrorAt = new Date().toISOString(); onFailure(e); });
    return rec.id;
  };
  return {
    session, root,
    log: write,
    // A recorder bound to one agent, in the shape the Talk code expects: record(type, payload).
    for: agent => (type, payload) => write(type, agent, payload),
    // Wrap a model call so every attempt is recorded with its stage, full prompt, raw output, model, stop reason,
    // latency, usage, and the memory context that was actually supplied.
    wrapLLM(llm, agent) {
      return async call => {
        const { stage, context, attempt, ...rest } = call;
        const meta = rest.meta || {}, t0 = Date.now();
        const base = { stage: stage || 'unlabeled', attempt: attempt ?? 1, system: rest.system, messages: rest.messages || [{ role: 'user', content: rest.user }], max_tokens: rest.max_tokens ?? null, context: context ?? null, structured: Boolean(rest.schema) };
        try {
          const out = await llm({ ...rest, stage, meta });
          write('model_call', agent, { ...base, output: out, model: meta.model ?? null, stop_reason: meta.stop_reason ?? null, usage: meta.usage ?? null, retries: meta.retries ?? 0, structured: meta.structured ?? base.structured, latency_ms: Date.now() - t0 });
          return out;
        } catch (e) {
          write('model_call', agent, { ...base, error: e.message, error_kind: e.kind || null, latency_ms: Date.now() - t0 });
          throw e;
        }
      };
    },
    flush: async () => { await chain; if (pending.length) { chain = chain.then(drain).catch(() => {}); await chain; } },
    // ok is false after any failed append, even if a later retry drained the queue: the gap in time is reported, not hidden.
    health: () => ({ ...health, pending: pending.length, ok: health.failedWrites === 0 && pending.length === 0 }),
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
