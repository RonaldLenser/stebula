// One mapping from internal errors to what the browser is told. Each failure names its stage and kind and
// carries a recovery action, so the interface can show it next to the interaction instead of a generic "error".
import { StageError, isCancelled } from './stage.js';

const RECOVERY = {
  refusal: 'The provider declined this request. Reword your message and send it again.',
  truncation: 'The reply was cut off at the length limit. Send a shorter message, or retry.',
  malformed: 'The model returned something the app could not read, twice. Retry.',
  schema: 'The model returned the wrong shape of answer, twice. Retry.',
  empty: 'The model returned no text. Retry.',
  transport: 'The model service did not answer. Check your connection, then retry.',
  timeout: 'The model took too long to answer. Retry.',
  budget: 'The call budget was reached. Raise it on purpose or lower the size of the run.',
};

export function errorInfo(e) {
  if (isCancelled(e)) return { status: 499, body: { error: 'Cancelled. No further model calls were made.', kind: 'cancelled', recovery: 'Start again when ready.' } };
  if (e instanceof StageError) return { status: 502, body: { error: `The ${e.stage} step failed: ${e.detail}`, stage: e.stage, kind: e.kind, detail: e.detail, attempts: e.attempts?.length ?? 0, passage: e.passage ?? null, recovery: RECOVERY[e.kind] || 'Retry.' } };
  if (e?.name === 'CorruptMemoryError' || e?.name === 'CorruptRegistryError') return { status: 409, body: { error: e.message, kind: 'corrupt', recovery: 'start-fresh' } };
  if (e?.kind === 'budget') return { status: 400, body: { error: e.message, kind: 'budget', recovery: RECOVERY.budget } };
  if (e?.kind === 'timeout' || e?.kind === 'transport') return { status: 502, body: { error: e.message, kind: e.kind, recovery: RECOVERY[e.kind] } };
  if (e instanceof SyntaxError) return { status: 400, body: { error: 'The request body was not valid JSON.', kind: 'request' } };
  return { status: e?.status || 500, body: { error: e?.message || 'Unexpected error', kind: e?.name === 'ValidationError' ? 'request' : 'internal' } };
}
