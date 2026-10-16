// Browser calls the local server, which holds the API key.
const token = () => { try { return localStorage.getItem('stebula.token') || ''; } catch { return ''; } };
export async function browserLLM({ system, user }) {
  const r = await fetch('/api/llm', { method: 'POST', headers: { 'content-type': 'application/json', ...(token() ? { authorization: `Bearer ${token()}` } : {}) }, body: JSON.stringify({ system, user }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `LLM request failed (${r.status})`);
  return j.text;
}
