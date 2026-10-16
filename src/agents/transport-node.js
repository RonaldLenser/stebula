// Node transport for the Anthropic Messages API.
// - Temperature is optional: newer models reject it, so if the API says it is deprecated we drop it for the session.
// - Structured output: when a call passes `schema`, it is sent as output_config.format (json_schema). If the API
//   rejects that for the configured model we stop sending it and rely on code validation alone.
// - Every request has a timeout, honors a caller's AbortSignal, and retries transient failures (429, 5xx, network)
//   with bounded exponential backoff. A cancelled signal stops the call and any pending retry immediately.
import { CancelledError } from '../lib/stage.js';

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504, 529]);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new CancelledError());
  const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(new CancelledError()); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

export function makeNodeLLM({
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.MODEL || 'claude-sonnet-5-5',
  temperature = process.env.TEMPERATURE === undefined || process.env.TEMPERATURE === '' ? null : Number(process.env.TEMPERATURE),
  maxTokens = 900,
  timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS) || 90_000,
  maxRetries = process.env.MAX_RETRIES === undefined ? 2 : Number(process.env.MAX_RETRIES),
  backoffMs = 800,
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing. Copy .env.example to .env and add a key, or use mock mode.');
  let useTemperature = Number.isFinite(temperature);
  let useSchema = true;

  // Accepts { system, user } or { system, messages: [{role, content}] }. Optional: max_tokens, meta, signal, schema.
  return async function call({ system, user, messages, max_tokens, meta, signal, schema }) {
    const body = { model, max_tokens: max_tokens || maxTokens, system, messages: messages || [{ role: 'user', content: user }] };
    if (useTemperature) body.temperature = temperature;
    if (schema && useSchema) body.output_config = { format: { type: 'json_schema', schema } };
    let retries = 0;
    for (;;) {
      if (signal?.aborted) throw new CancelledError();
      const timer = new AbortController();
      const timeout = setTimeout(() => timer.abort(new Error('timeout')), timeoutMs);
      const onAbort = () => timer.abort(new CancelledError());
      signal?.addEventListener('abort', onAbort, { once: true });
      let res = null, netErr = null;
      try {
        res = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: timer.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify(body),
        });
      } catch (e) { netErr = e; }
      clearTimeout(timeout); signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) throw new CancelledError();
      let errText = '';
      if (netErr) {
        const timedOut = timer.signal.aborted && /timeout/.test(String(timer.signal.reason?.message));
        const e = new Error(timedOut ? `Model request timed out after ${timeoutMs} ms` : `Network error: ${netErr.message}`);
        e.kind = timedOut ? 'timeout' : 'transport';
        if (retries < maxRetries) { retries++; await sleep(backoffMs * 2 ** (retries - 1) + Math.random() * 200, signal); continue; }
        e.retries = retries; throw e;
      }
      if (!res.ok) {
        errText = await res.text();
        if (res.status === 400 && useTemperature && /temperature/i.test(errText)) { useTemperature = false; delete body.temperature; log('Model does not accept temperature. Continuing without it.'); continue; }
        if (res.status === 400 && body.output_config && /output_config|json_schema|structured/i.test(errText)) { useSchema = false; delete body.output_config; log('Model rejected structured output. Continuing with prompt-only JSON and code validation.'); continue; }
        if (TRANSIENT.has(res.status) && retries < maxRetries) {
          retries++;
          const ra = Number(res.headers?.get?.('retry-after'));
          await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 20_000) : backoffMs * 2 ** (retries - 1) + Math.random() * 200, signal);
          continue;
        }
        const e = new Error(`Anthropic API ${res.status}: ${errText.slice(0, 300)}`);
        e.kind = 'transport'; e.status = res.status; e.retries = retries; throw e;
      }
      const data = await res.json();
      if (meta) Object.assign(meta, { model: data.model ?? model, stop_reason: data.stop_reason ?? null, usage: data.usage ?? null, retries, structured: Boolean(body.output_config) });
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      if (!text) log(`Model returned no text (stop_reason: ${data.stop_reason}).`);
      return text;
    }
  };
}
