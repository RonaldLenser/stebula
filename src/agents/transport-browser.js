// Browser calls the local server, which holds the API key.
export async function browserLLM({ system, user }) {
  const r = await fetch('/api/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system, user }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `LLM request failed (${r.status})`);
  return j.text;
}
