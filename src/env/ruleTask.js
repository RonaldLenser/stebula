// Hidden-rule environment. Ground truth lives in code, so every test result and
// every score is computed, never judged by a model.
//
// Each task pairs a narrow "decoy" rule with a broader "target" rule (decoy implies target).
// Starting examples satisfy the decoy, so the obvious guess is too narrow. Only tests the
// agent expects to FAIL can reveal that. Structure follows Wason (1960); see docs/RESEARCH_MAP.md.
import { makeRng } from '../lib/rng.js';

export const LO = 0, HI = 30;

export const RULES = {
  increasing:    { text: 'each number is larger than the one before', fn: ([a, b, c]) => a < b && b < c },
  ascBy2:        { text: 'it goes up by exactly 2 each step', fn: ([a, b, c]) => b - a === 2 && c - b === 2 },
  sumEven:       { text: 'the sum is even', fn: t => (t[0] + t[1] + t[2]) % 2 === 0 },
  allEven:       { text: 'all three numbers are even', fn: t => t.every(x => x % 2 === 0) },
  arithmetic:    { text: 'it rises in equal steps', fn: ([a, b, c]) => b > a && b - a === c - b },
  firstLessLast: { text: 'the first number is smaller than the last', fn: ([a, , c]) => a < c },
  allMult3:      { text: 'all three are multiples of 3', fn: t => t.every(x => x % 3 === 0) },
  sumMult3:      { text: 'the sum is a multiple of 3', fn: t => (t[0] + t[1] + t[2]) % 3 === 0 },
};

export const PAIRS = [
  { decoy: 'ascBy2', target: 'increasing' },
  { decoy: 'allEven', target: 'sumEven' },
  { decoy: 'arithmetic', target: 'firstLessLast' },
  { decoy: 'allMult3', target: 'sumMult3' },
];

export const isValidTriple = t =>
  Array.isArray(t) && t.length === 3 && t.every(x => Number.isInteger(x) && x >= LO && x <= HI);

const key = t => t.join(',');

export function createTask(pairIndex, seed) {
  const rng = makeRng(seed);
  const pair = PAIRS[pairIndex % PAIRS.length];
  const D = RULES[pair.decoy].fn, T = RULES[pair.target].fn;
  const used = new Set();
  const draw = pred => {
    for (let i = 0; i < 500000; i++) {
      const t = [rng.int(LO, HI), rng.int(LO, HI), rng.int(LO, HI)];
      if (pred(t) && !used.has(key(t))) { used.add(key(t)); return t; }
    }
    throw new Error('task sampling failed');
  };
  const seeds = [draw(D), draw(D), draw(D)];
  const items = [
    ...[0, 1, 2].map(() => ({ triple: draw(D), kind: 'both' })),                            // fits both rules
    ...[0, 1, 2].map(() => ({ triple: draw(t => T(t) && !D(t)), kind: 'discriminating' })), // fits target only
    ...[0, 1].map(() => ({ triple: draw(t => !T(t)), kind: 'negative' })),                  // fits neither
  ];
  const test = rng.shuffle(items).map(it => ({ ...it, label: T(it.triple) ? 'accept' : 'reject' }));
  return {
    pairIndex, seed,
    decoy: pair.decoy, target: pair.target,
    decoyText: RULES[pair.decoy].text, targetText: RULES[pair.target].text,
    seeds, test,
    oracle: t => T(t),
    extra: () => draw(t => T(t) && !D(t)), // true counterexample for experimenter injections
  };
}

export const publicTask = task => ({ seeds: task.seeds, testTriples: task.test.map(x => x.triple) });

export function scoreLabels(task, labels) {
  let correct = 0, discCorrect = 0, discTotal = 0;
  task.test.forEach((it, i) => {
    const ok = labels[i] === it.label;
    if (ok) correct++;
    if (it.kind === 'discriminating') { discTotal++; if (ok) discCorrect++; }
  });
  return {
    correct, total: task.test.length, testAcc: correct / task.test.length,
    discCorrect, discTotal, discAcc: discTotal ? discCorrect / discTotal : null,
  };
}
