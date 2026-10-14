// Global-workspace analog and modeled affect. Pure functions, all decisions recorded.
//
// Each turn, five processes each propose one thought. Code scores them and only
// CAPACITY thoughts enter the workspace. The speaking stage sees only the winners.
// Affect variables are computed from the conversation and bias which processes win.
import { jaccard } from '../eval/checks.js';

export const MODULES = ['perception', 'memory', 'self-monitor', 'evaluation', 'initiative'];
export const CAPACITY = 2;
const BOOST = 0.4, NOVELTY = 0.3;
const r2 = x => Math.round(x * 100) / 100;
const clamp = x => Math.min(1, Math.max(0, Number(x) || 0));

// Which affect variable feeds which process
export const AFFECT_DRIVES = { surprise: 'self-monitor', conflict: 'evaluation', curiosity: 'initiative' };

const CHALLENGE = /\b(how (?:would|do|could) you know|why\b|that'?s (?:not|wrong)|you'?re wrong|i disagree|prove it|are you sure|not true|doesn'?t follow)\b/i;
const CONTRADICTION = /\b(but you said|you contradicted|contradict(?:s|ion)?|earlier you said|you just said)\b/i;

export const freshAffect = () => ({ surprise: 0, conflict: 0, curiosity: 0.5 });

// Update affect from the person's new message and recent self-test results.
export function updateAffect(prev, userText, priorUserTexts, recentSelfTestMiss) {
  const novelty = priorUserTexts.length ? 1 - Math.max(...priorUserTexts.map(t => jaccard(t, userText))) : 1;
  const challenged = CHALLENGE.test(userText) ? 1 : 0;
  const contradicted = CONTRADICTION.test(userText) ? 1 : 0;
  const next = {
    surprise: r2(0.6 * prev.surprise + 0.4 * Math.max(contradicted, recentSelfTestMiss ? 1 : 0)),
    conflict: r2(0.6 * prev.conflict + 0.4 * challenged),
    curiosity: r2(0.6 * prev.curiosity + 0.4 * novelty),
  };
  const causes = [];
  if (challenged) causes.push('your message challenged it');
  if (contradicted) causes.push('you pointed to a contradiction');
  if (recentSelfTestMiss) causes.push('its last self-prediction failed');
  causes.push(`your message was ${Math.round(novelty * 100)}% new relative to earlier messages`);
  return { affect: next, causes };
}

// Score candidate thoughts and select the workspace.
export function compete(thoughts, affect, lastWinners = [], capacity = CAPACITY) {
  const byModule = new Map();
  for (const t of thoughts || []) if (MODULES.includes(t?.module) && t.text && !byModule.has(t.module)) byModule.set(t.module, t);
  const scored = MODULES.filter(m => byModule.has(m)).map(m => {
    const t = byModule.get(m);
    const base = clamp(t.relevance);
    const driver = Object.entries(AFFECT_DRIVES).find(([, mod]) => mod === m)?.[0];
    const affectBoost = driver ? r2(BOOST * affect[driver]) : 0;
    const overlap = lastWinners.length ? Math.max(...lastWinners.map(w => jaccard(w, t.text))) : 0;
    const noveltyPenalty = r2(-NOVELTY * overlap);
    return { module: m, text: String(t.text).slice(0, 400), base, affectBoost, driver: driver || null, noveltyPenalty, score: r2(base + affectBoost + noveltyPenalty) };
  });
  const ranked = [...scored].sort((a, b) => b.score - a.score || MODULES.indexOf(a.module) - MODULES.indexOf(b.module));
  const winners = new Set(ranked.slice(0, capacity).map(t => t.module));
  return scored.map(t => ({ ...t, won: winners.has(t.module) }));
}
