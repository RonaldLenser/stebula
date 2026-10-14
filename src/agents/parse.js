// Tolerant JSON extraction for model output.
// Handles code fences, leading or trailing prose, and (via salvageString) truncated output.
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/```(?:json)?/gi, '');
  const s = t.indexOf('{');
  if (s < 0) return null;
  // Try the widest span first, then shrink to earlier closing braces.
  for (let e = t.lastIndexOf('}'); e > s; e = t.lastIndexOf('}', e - 1)) {
    try { return JSON.parse(t.slice(s, e + 1)); } catch { /* keep shrinking */ }
  }
  return null;
}

// Pull one string field out of JSON that may be cut off. Returns null if the field never started.
export function salvageString(text, field) {
  if (typeof text !== 'string') return null;
  const m = text.match(new RegExp(`"${field}"\\s*:\\s*"`));
  if (!m) return null;
  let i = m.index + m[0].length, out = '';
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
    if (c === '"') break;
    out += c; i++;
  }
  try { return JSON.parse(`"${out.replace(/\\$/, '')}"`); } catch { return out.replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
}
