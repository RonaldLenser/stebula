// A protocol is written down and hashed BEFORE any model call of an experiment. It names the design, the
// predictions (copied from locked findings), and the parameters. The same file is stored with the results,
// so a result can always be traced to the protocol and code revision that produced it.
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '../lib/atomic.js';

export function lockProtocol({ id, version, design, predictions = [], params = {}, manifest = {} }, now = new Date().toISOString()) {
  const core = { id, version, design, predictions, params };
  const hash = createHash('sha256').update(JSON.stringify(core)).digest('hex').slice(0, 16);
  return { ...core, hash, lockedAt: now, manifest };
}

// Writes protocol.json and returns its path. Callers must do this before the first model call.
export async function writeProtocol(dir, protocol) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'protocol.json');
  await writeFileAtomic(file, JSON.stringify(protocol, null, 1));
  return file;
}

// Predictions of every live (not superseded) finding that an experiment will feed, as they stand now.
export const livePredictions = (reg, metricSource = 'experiment', metrics, keep = () => true) => reg.findings
  .filter(f => !f.supersededBy && f.computable && metrics[f.metric.name]?.source === metricSource && keep(f))
  .map(f => ({ finding: `${f.id}@${f.version}`, key: f.key, statement: f.statement, prediction: f.prediction, refutedIf: f.refutedIf, lockHash: f.lockHash, lockedAt: f.lockedAt }));
