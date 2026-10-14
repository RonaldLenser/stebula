export function makeNodeLLM({
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.MODEL || 'claude-sonnet-5-5',
  temperature = Number(process.env.TEMPERATURE ?? 0.7),
  maxTokens = 900,
} = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing. Copy .env.example to .env and add a key, or use mock mode.');
  // Accepts either { system, user } or { system, messages: [{role, content}] }.
  return async ({ system, user, messages, max_tokens }) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: max_tokens || maxTokens, temperature, system, messages: messages || [{ role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  };
}
