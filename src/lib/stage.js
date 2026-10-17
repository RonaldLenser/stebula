// One model stage = prompt, bounded attempts, validation, and an explicit outcome.
// A stage never "succeeds quietly": it returns ok:true with a validated value, or ok:false with the failure kind
// (refusal, truncation, malformed, schema, empty, transport, timeout, cancelled) and every raw attempt.
import { extractJson } from '../agents/parse.js';

export const FAILURE_KINDS = ['refusal', 'truncation', 'malformed', 'schema', 'empty', 'transport', 'timeout', 'cancelled'];
// Kinds a second attempt can plausibly fix. A refusal is not retried: the same prompt gets the same answer.
const RETRYABLE = new Set(['truncation', 'malformed', 'schema', 'empty']);

export class StageError extends Error {
  constructor(stage, kind, detail, attempts = []) {
    super(`${stage} failed (${kind}): ${detail}`);
    this.name = 'StageError'; this.stage = stage; this.kind = kind; this.detail = detail; this.attempts = attempts;
  }
}
export class CancelledError extends Error {
  constructor(msg = 'Cancelled') { super(msg); this.name = 'CancelledError'; this.kind = 'cancelled'; }
}
export const isCancelled = e => e?.name === 'CancelledError' || e?.name === 'AbortError' || e?.kind === 'cancelled';
export const throwIfAborted = signal => { if (signal?.aborted) throw new CancelledError(); };

const RETRY_TAIL = '\n\nYour previous answer could not be used. Reply again with only the JSON object described above. Keep every field short.';

// spec: { stage, system, user|messages, max_tokens, schema?, validate(obj) -> string|null (reason) , retries, signal, context, onAttempt }
// llm: the (possibly recorder-wrapped) model function. It fills `meta` with stop_reason, usage, model.
export async function runStage(llm, spec) {
  const { stage, validate, retries = 1, signal } = spec;
  const attempts = [];
  let maxTokens = spec.max_tokens || 900;
  for (let n = 1; n <= retries + 1; n++) {
    throwIfAborted(signal);
    const meta = {};
    const messages = spec.messages ? spec.messages.map(m => ({ ...m })) : null;
    if (messages && n > 1) messages[messages.length - 1].content += RETRY_TAIL;
    const user = messages ? undefined : spec.user + (n > 1 ? RETRY_TAIL : '');
    const t0 = Date.now();
    let raw = '', kind = null, detail = '', obj = null;
    try {
      raw = await llm({ system: spec.system, messages, user, max_tokens: maxTokens, stage: n > 1 ? `${stage}-retry` : stage, schema: spec.schema, signal, context: spec.context, attempt: n, meta });
    } catch (e) {
      if (isCancelled(e)) throw new CancelledError();
      if (e.kind === 'budget') throw e; // a spending cap is not a model failure: it stops the whole run
      kind = e.kind === 'timeout' ? 'timeout' : 'transport'; detail = String(e.message || e).slice(0, 300);
    }
    if (!kind) {
      const stop = meta.stop_reason || null;
      if (stop === 'refusal') { kind = 'refusal'; detail = `The provider ended the response with stop_reason "refusal" and ${meta.usage?.output_tokens ?? 'an unknown number of'} output tokens. No text was returned.`; }
      else if (!String(raw || '').trim()) { kind = stop === 'max_tokens' ? 'truncation' : 'empty'; detail = `No text returned (stop_reason: ${stop ?? 'unknown'}).`; }
      else if (spec.text) obj = String(raw).trim(); // plain-text stage: any non-empty text is the value
      else {
        obj = extractJson(raw);
        if (!obj) { kind = stop === 'max_tokens' ? 'truncation' : 'malformed'; detail = stop === 'max_tokens' ? 'Output hit the token limit before the JSON closed.' : 'Output was not valid JSON.'; }
        else { const why = validate ? validate(obj) : null; if (why) { kind = 'schema'; detail = why; } }
      }
    }
    attempts.push({ n, kind: kind || 'ok', detail, stop_reason: meta.stop_reason ?? null, usage: meta.usage ?? null, model: meta.model ?? null, latency_ms: Date.now() - t0, max_tokens: maxTokens, raw });
    spec.onAttempt?.(attempts.at(-1));
    if (!kind) return { ok: true, value: obj, raw, status: 'ok', attempts };
    if (!RETRYABLE.has(kind)) break;
    if (kind === 'truncation') maxTokens = Math.min(maxTokens * 2, 8000);
  }
  const last = attempts.at(-1);
  return { ok: false, value: null, raw: last.raw, status: 'failed', failure: { kind: last.kind, detail: last.detail }, attempts };
}

// Like runStage but throws StageError. For stages where there is no honest fallback (the reply itself).
export async function requireStage(llm, spec) {
  const r = await runStage(llm, spec);
  if (!r.ok) throw new StageError(spec.stage, r.failure.kind, r.failure.detail, r.attempts);
  return r;
}

// Compact, record-friendly summary of a stage result (raw outputs are already in the model_call records).
export const stageSummary = (stage, r) => ({ stage, status: r.status, failure: r.failure || null, attempts: r.attempts.map(({ raw, ...a }) => a) });
