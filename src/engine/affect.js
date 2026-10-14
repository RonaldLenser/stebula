// Modeled affect: functional variables computed from recorded outcomes.
// Not self-reported, and not evidence of felt emotion.
const r2 = x => Math.round(x * 100) / 100;

export function computeAffect(agentId, obs, lastOwnTurn, partnerLastTurn) {
  const own = obs.filter(o => o.by === agentId && o.predicted);
  const recent = own.slice(-3);
  return {
    surprise: recent.length ? r2(recent.filter(o => o.surprise).length / recent.length) : 0, // arousal analog
    successTrend: own.length ? r2(own.filter(o => !o.surprise).length / own.length) : 0.5,  // valence analog
    conflict: partnerLastTurn?.challenge ? 1 : 0,                                            // partner challenged it
    confidence: lastOwnTurn?.confidence ?? null,
  };
}
