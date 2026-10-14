# Experiment 01: Does reflection on measured behavior change later decisions?

## Setup

Each episode is a hidden-rule task. Agents see three accepted triples of numbers (0 to 30). Those examples fit a narrow decoy rule, but the real rule is broader. Example: seeds `[4, 6, 8]`, `[12, 14, 16]`, `[20, 22, 24]` fit "goes up by 2", but the rule is "each number is larger than the last".

The only way to discover this is to run tests your current guess predicts will be **rejected**. Confirming tests cannot expose a rule that is too narrow (Wason 1960; Klayman and Ha 1987).

Protocol per episode:

1. Encounter: seed examples. Round 1, each agent forms a view independently (no partner message), so pre-existing agreement can be measured.
2. Retrieve: persistent memory is pasted into the prompt.
3. Predict and test: each agent states a hypothesis, confidence, a test triple, and its prediction. Code returns the true result.
4. Question: agents see the partner's last message and may challenge one assumption.
5. Synthesis: final hypothesis, what was established ("nothing new" is allowed), what is unresolved.
6. Decide alone: classify 8 new triples, including 3 "hardest items" that fit the real rule but not the decoy.
7. Reveal and score (code).
8. Reflect: agents get their measured behavior (how many tests they expected to fail, prediction accuracy, scores, the real rule) and rewrite their self-model and lessons.
9. Record: memory diff stored and shown.

Episode 2 uses a different rule family. Memory carries over depending on condition.

## Conditions

| Condition | Agents | Memory across episodes | Reflection |
|---|---|---|---|
| dyad-reflect | 2 | yes | yes |
| dyad-noreflect | 2 | scores only | no |
| dyad-nomemory | 2 | wiped | yes (but lost) |
| single-reflect | 1 (same number of tests) | yes | yes |

## Measures (all computed by code)

- Hardest-item accuracy (primary)
- Rate of tests the agent expected to fail (process measure)
- Prediction accuracy, calibration gap (confidence minus accuracy)
- Stated-vs-actual: does a stored lesson about testing failures show up as more such tests in episode 2?
- Evaluator flags

## Predictions if the hypothesis has something to it

- H1: dyad-reflect improves from episode 1 to 2 more than dyad-noreflect and dyad-nomemory, on hardest-item accuracy and expected-failure test rate.
- H2: dyad-reflect beats single-reflect in episode 1 (disagreement produces discriminating tests).
- H3: when a lesson is written, behavior moves the way it says more often than not.

## What counts against the hypothesis

- No difference between reflect and no-memory conditions across 20+ seeds (intervals overlap zero).
- Improvement appears equally in dyad-nomemory: then it is practice or task order, not memory.
- Stated-action gaps outnumber enacted lessons: self-model text is decoration, not control.
- Dyad no better than single: interaction adds words, not understanding.
- Agreement is mostly present in round 1 (shared-prior flag) and consensus does not track accuracy.

## What would be uninformative, not counterevidence

- Ceiling: if all conditions score near 100% on hardest items in episode 1, the model already knows the strategy (it has likely read about the 2-4-6 task). Then this task cannot detect growth. Move to v0.3's novel task family.
- Parse failures above about 10% of turns: fix prompts before interpreting.

## What even full support would and would not mean

Support shows that, in this system, interaction plus reflection on measured behavior produces stored self-descriptions that change later choices. That is a functional property: a self-model that does causal work. It says nothing about whether any of it is experienced.
