// Node transport for the Anthropic Messages API.
// Temperature is optional: newer models reject it, so if the API says it is deprecated
// we drop it and remember that for the rest of the session.
export function makeNodeLLM({
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.MODEL || 'claude-sonnet-5-5',
  temperature = process.env.TEMPERATURE === undefined || process.env.TEMPERATURE === '' ? null : Number(process.env.TEMPERATURE),
  maxTokens = 900,
} = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing. Copy .env.example to .env and add a key, or use mock mode.');
  let useTemperature = Number.isFinite(temperature);

  // Accepts either { system, user } or { system, messages: [{role, content}] }.
  return async function call({ system, user, messages, max_tokens, meta }) {
    const body = { model, max_tokens: max_tokens || maxTokens, system, messages: messages || [{ role: 'user', content: user }] };
    if (useTemperature) body.temperature = temperature;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400 && useTemperature && /temperature/i.test(text)) {
        useTemperature = false;
        console.log('Model does not accept temperature. Continuing without it.');
        return call({ system, user, messages, max_tokens, meta });
      }
      throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    if (meta) Object.assign(meta, { model: data.model ?? model, stop_reason: data.stop_reason ?? null, usage: data.usage ?? null });
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    if (!text) console.log(`Model returned no text (stop_reason: ${data.stop_reason}).`);
    return text;
  };
}
