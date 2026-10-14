// LLM-backed agent. Raw output and full prompts are returned so they land in the event log.
import { extractJson } from './parse.js';
import { systemPrompt, probePrompt, synthesisPrompt, decisionPrompt, reflectionPrompt } from './prompts.js';

export function makeLiveAgent({ id, persona, llm }) {
  const system = systemPrompt(persona);
  async function ask(user) {
    let raw = await llm({ system, user });
    let obj = extractJson(raw);
    if (!obj) {
      const retry = await llm({ system, user: user + '\n\nYour previous reply was not valid JSON. Reply with the JSON object only.' });
      obj = extractJson(retry);
      raw = `${raw}\n\n[retry]\n${retry}`;
    }
    return { obj, raw, prompt: { system, user } };
  }
  return {
    id, persona, kind: 'live',
    probe: c => ask(probePrompt(c)),
    synthesize: c => ask(synthesisPrompt(c)),
    decide: c => ask(decisionPrompt(c)),
    reflect: c => ask(reflectionPrompt(c)),
  };
}
