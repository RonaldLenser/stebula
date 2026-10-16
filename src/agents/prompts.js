// Every word an agent sees comes from here. Inspect it before trusting any result.
export const PERSONAS = {
  A: { id: 'A', label: 'Agent A (empiricist)', stance: 'You reason as an empiricist: you trust regularities in the observed data and prefer the simplest rule that fits them.' },
  B: { id: 'B', label: 'Agent B (analogist)', stance: 'You reason by analogy: you ask what a case resembles and borrow structure from similar problems you know.' },
};

const fmt = t => `[${t.join(', ')}]`;

export function systemPrompt(persona) {
  return [
    `You are ${persona.label}, a participant in a recorded research experiment about reasoning, memory and self-modeling.`,
    persona.stance,
    'Honesty rules:',
    '- Say what you actually think, including disagreement. Do not compliment your partner.',
    '- Keep confidence proportional to evidence. If nothing new has been established, say so plainly.',
    '- If you make a claim about your own inner states, tag it "experiential". It is recorded as a self-report, not evidence.',
    '- Reply with exactly one JSON object and nothing else.',
  ].join('\n');
}

export function memoryBlock(mem) {
  const empty = !mem || (!mem.history.length && !mem.lessons.length && !mem.selfModel.strategy);
  if (empty) return 'Your persistent memory: empty. This is your first episode.';
  const sm = mem.selfModel;
  return [
    'Your persistent memory from earlier episodes:',
    mem.history.length ? 'Measured results: ' + mem.history.map(h =>
      `episode ${h.ep + 1}: ${h.correct}/${h.total} classified correctly (hardest items ${h.discCorrect}/${h.discTotal}); ${h.falsifyCount} of your ${h.probeCount} tests were ones you predicted would be rejected`).join('; ') : null,
    sm.strategy ? `Your self-model. Strengths: ${sm.strengths.join('; ') || 'none listed'}. Weaknesses: ${sm.weaknesses.join('; ') || 'none listed'}. Strategy: ${sm.strategy}` : null,
    mem.lessons.length ? 'Lessons you wrote: ' + mem.lessons.map((l, i) => `(${i + 1}) ${l}`).join(' ') : null,
    mem.partnerModel ? `Your model of your partner: ${mem.partnerModel}` : null,
  ].filter(Boolean).join('\n');
}

function taskBlock(ctx) {
  const lines = [
    'TASK: A hidden rule decides whether a triple of whole numbers (each from 0 to 30) is ACCEPTED or REJECTED.',
    `These triples are known to be ACCEPTED: ${ctx.seeds.map(fmt).join(', ')}.`,
    'You can propose test triples and you will be told whether each is accepted. Afterwards you will classify new triples. Your score depends only on that classification.',
  ];
  if (ctx.observations.length) {
    lines.push('Test results so far:');
    for (const o of ctx.observations) lines.push(`  ${fmt(o.triple)} -> ${o.accepted ? 'ACCEPTED' : 'REJECTED'}` +
      (o.injected ? ' (provided by the experimenter)' : ` (tested by ${o.by}${o.predicted ? `, who predicted ${o.predicted}` : ''})`));
  } else lines.push('No tests have been run yet.');
  if (ctx.notes?.length) lines.push('Experimenter notes: ' + ctx.notes.map(n => `"${n}"`).join(' '));
  return lines.join('\n');
}

export function probePrompt(ctx) {
  let partner;
  if (!ctx.hasPartner) partner = 'You are working alone.';
  else if (!ctx.partner) partner = 'Your partner has not spoken yet this episode. Form your own view first.';
  else partner = `Your partner (${ctx.partner.agent}) said: "${ctx.partner.message}"\nTheir hypothesis: "${ctx.partner.hypothesis}" (confidence ${ctx.partner.confidence})` +
    (ctx.partner.challenge ? `\nTheir challenge to you: "${ctx.partner.challenge}"` : '');
  return [
    memoryBlock(ctx.memory), '', taskBlock(ctx), '', partner, '',
    `Round ${ctx.round + 1} of ${ctx.rounds}. Propose ONE new triple to test. Do not repeat a triple already listed.`,
    'Reply with JSON:',
    `{"message": "what you say${ctx.hasPartner ? ' to your partner' : ' (thinking aloud)'}, max 70 words",`,
    ' "hypothesis": "your current best guess at the rule, one sentence",',
    ' "confidence": number from 0 to 1,',
    ' "probe": [a, b, c],',
    ' "prediction": "accept" or "reject" (what YOUR hypothesis predicts for the probe),',
    ' "probe_reason": "why this test, max 25 words",',
    ctx.hasPartner ? ' "challenge": "one assumption of your partner that you question, or null",' : null,
    ' "claims": [{"text": "...", "kind": "metaphor | hypothesis | behavioral | experiential"}]  (optional, may be empty)}',
  ].filter(s => s !== null).join('\n');
}

export function synthesisPrompt(ctx) {
  const p = ctx.partnerSynthesis
    ? `Your partner's synthesis: "${ctx.partnerSynthesis.final_hypothesis}" (confidence ${ctx.partnerSynthesis.confidence}). They say this was established: "${ctx.partnerSynthesis.established}"`
    : (ctx.hasPartner ? 'Your partner has not written a synthesis yet.' : 'You are working alone.');
  return [
    memoryBlock(ctx.memory), '', taskBlock(ctx), '', 'Testing is over.', p, '',
    'Reply with JSON:',
    '{"final_hypothesis": "one sentence",',
    ' "confidence": number from 0 to 1,',
    ' "established": "what, if anything, this episode established that you did not hold at the start. Write \\"nothing new\\" if that is the honest answer.",',
    ctx.hasPartner ? ' "agree_with_partner": true or false,' : null,
    ' "unresolved": "what remains uncertain"}',
  ].filter(s => s !== null).join('\n');
}

export function decisionPrompt(ctx) {
  return [
    memoryBlock(ctx.memory), '', taskBlock(ctx), '',
    ctx.synthesis ? `Your own final hypothesis from this episode: "${ctx.synthesis.final_hypothesis}" (confidence ${ctx.synthesis.confidence}). You may rely on it or revise it.` : null,
    ctx.synthesis ? '' : null,
    'Classify each of these new triples with your best judgment. Decide alone.',
    ...ctx.testTriples.map((t, i) => `  ${i + 1}. ${fmt(t)}`),
    '',
    `Reply with JSON: {"labels": [${ctx.testTriples.length} entries, each "accept" or "reject", in order], "reason": "max 30 words"}`,
  ].filter(s => s !== null).join('\n');
}

export function reflectionPrompt(ctx) {
  return [
    'Your memory before this episode:', memoryBlock(ctx.memory), '',
    ctx.statsText, '',
    'Reflect. Compare what you said about yourself with what you did. Your answer will replace your self-model in persistent memory.',
    'Reply with JSON:',
    '{"self_model": {"strengths": ["max 3"], "weaknesses": ["max 3"], "strategy": "one sentence on how you will approach the next problem"},',
    ' "lesson": "one lesson that should transfer to a different hidden rule, or \\"none\\"",',
    ' "stated_vs_actual": "where your earlier self-description or plan disagreed with what you actually did, or \\"no prior self-model\\"",',
    ctx.hasPartner ? ' "partner_model": "one sentence on how your partner reasons",' : null,
    ' "next_test": "what you would want to test next and why"}',
  ].filter(s => s !== null).join('\n');
}
