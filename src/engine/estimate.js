// Model calls a run will make BEFORE retries, computed from the execution plan (not guessed).
// Per episode: each agent probes once per round (single-agent conditions run twice as many rounds so the number of
// tests matches), then one synthesis and one decision per agent, then one reflection per agent if the condition reflects.
import { CONDITIONS } from './run.js';

export function callsPerRun(conditionId, { rounds = 4, episodes = 2 } = {}) {
  const c = CONDITIONS[conditionId];
  if (!c) throw new Error('Unknown condition: ' + conditionId);
  const agents = c.agents.length, dyad = agents > 1;
  const probes = agents * (dyad ? rounds : rounds * 2);
  return episodes * (probes + agents * 2 + (c.reflect ? agents : 0));
}
export const estimateBatchCalls = ({ conditions = Object.keys(CONDITIONS), seeds = 5, rounds = 4, episodes = 2 } = {}) =>
  seeds * conditions.reduce((n, id) => n + callsPerRun(id, { rounds, episodes }), 0);
