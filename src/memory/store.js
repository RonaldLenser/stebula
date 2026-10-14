// Per-agent persistent memory. This is the ONLY thing that carries across episodes.
// It is text in a JSON object that gets pasted into prompts. Model weights never change.
export const emptyMemory = () => ({
  version: 0,
  selfModel: { strengths: [], weaknesses: [], strategy: '' },
  lessons: [],
  partnerModel: '',
  history: [], // measured results, written by the experiment, not by the agent
});

const clone = o => JSON.parse(JSON.stringify(o));

export function recordStats(mem, stats) {
  const m = clone(mem);
  m.history.push(stats);
  m.version++;
  return m;
}

export function applyReflection(mem, refl, stats) {
  const m = recordStats(mem, stats);
  if (refl?.self_model) m.selfModel = clone(refl.self_model);
  if (refl?.lesson && !/^none\.?$/i.test(refl.lesson.trim())) m.lessons.push(refl.lesson);
  if (refl?.partner_model) m.partnerModel = refl.partner_model;
  m.lessons = m.lessons.slice(-5);
  return m;
}

export function diffMemory(a, b) {
  const out = [];
  for (const k of ['selfModel', 'lessons', 'partnerModel', 'history']) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out.push({ field: k, before: a?.[k] ?? null, after: b?.[k] ?? null });
  }
  return out;
}
