// Wraps a model function and totals what it used: calls, failed calls, tokens, latency. Used for experiment manifests.
export function meterLLM(llm) {
  const totals = { calls: 0, failed: 0, input_tokens: 0, output_tokens: 0, latency_ms: 0, models: new Set() };
  const wrapped = async call => {
    const meta = call.meta || {}, t0 = Date.now();
    totals.calls++;
    try {
      const out = await llm({ ...call, meta });
      const u = meta.usage || {};
      totals.input_tokens += Number(u.input_tokens) || 0; totals.output_tokens += Number(u.output_tokens) || 0;
      if (meta.model) totals.models.add(meta.model);
      return out;
    } catch (e) { totals.failed++; throw e; } finally { totals.latency_ms += Date.now() - t0; }
  };
  wrapped.totals = () => ({ ...totals, models: [...totals.models] });
  return wrapped;
}
export const addTotals = (a, b) => ({ calls: a.calls + b.calls, failed: a.failed + b.failed, input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens, latency_ms: a.latency_ms + b.latency_ms, models: [...new Set([...a.models, ...b.models])] });
export const zeroTotals = () => ({ calls: 0, failed: 0, input_tokens: 0, output_tokens: 0, latency_ms: 0, models: [] });
