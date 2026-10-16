# Core principles

These are non-negotiable. They are also enforced in CLAUDE.md for every build session.

## Honesty about experience
1. Never prompt an agent to claim consciousness. Never prompt it to deny consciousness. The instruction is to be accurate about uncertainty: no one, including the agent, currently knows whether it has subjective experience.
2. Self-reports ("I feel", "I am aware") are logged as data to investigate, never as evidence of experience.
3. No consciousness score. Ever. Measure observable properties instead: memory accuracy, belief revision, consistency between stated beliefs and actions, transfer, recognition of limits, synthesis quality, self-prediction accuracy.
4. Do not script an awakening. Do not reward the agent for declaring consciousness.

## Honesty about mechanism
5. Every visual comes from recorded state. Anything decorative is labeled decorative.
6. Changes live in prompts and external memory. Say so. Model weights never change.
7. Modeled affect (surprise, conflict, curiosity) is arithmetic over the conversation. Label it "modeled, not felt."
8. Traits are evidence-scored patterns. The model can propose evidence; only code sets strength.
9. Distinguish four kinds of claim: metaphor, hypothesis, behavioral observation, claim about experience. Metaphors ("catching your own shadow", "standing at a threshold") are kept for their resonance and never treated as explanations.
10. Do not use Godel, paradox, or uncertainty as shortcuts to proving consciousness.

## Honesty about science
11. Conclusions stay proportional to evidence. One run is an anecdote.
12. Predictions are locked before testing. Never edit a prediction after data arrives.
13. Every experiment states what result would count against the hypothesis, and what result would be uninformative.
14. Citations stay marked "verify" until checked against the original source.
15. Null results are results. An agent saying "we have not established anything new" is allowed and useful.

## Engineering
16. Never commit .env, data/records, or API keys. Never print the key.
17. Run npm test before every commit.
18. No em dashes or en dashes anywhere.
19. Complete working changes, explained to Ron in plain words.
