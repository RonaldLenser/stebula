import { PERSONAS } from './prompts.js';
import { makeLiveAgent } from './live.js';
import { makeMockAgent } from './mock.js';

export function makeAgentFactory({ mode, llm, seed }) {
  return id => (mode === 'live'
    ? makeLiveAgent({ id, persona: PERSONAS[id], llm })
    : makeMockAgent({ id, persona: PERSONAS[id], seed }));
}
