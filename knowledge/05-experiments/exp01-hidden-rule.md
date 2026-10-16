# Experiment 01: Does reflection on measured behavior change later decisions?

Status: BUILT. Mock runs pass. Live runs pending.

## Design
Hidden-rule tasks (Wason 2-4-6 structure). Seeds fit a narrow decoy rule; the real rule is broader. Only tests expected to fail reveal it. Episode 2 uses a different rule family.

| Condition | Agents | Memory | Reflection |
|---|---|---|---|
| dyad-reflect | 2 | yes | yes |
| dyad-noreflect | 2 | scores only | no |
| dyad-nomemory | 2 | wiped | yes, but lost |
| single-reflect | 1 | yes | yes |

Measures (code): hardest-item accuracy (primary), rate of tests expected to fail, prediction accuracy, calibration, stated-vs-actual gaps.

## Predictions
- H1: dyad-reflect improves from episode 1 to 2 more than noreflect and nomemory.
- H2: dyad-reflect beats single-reflect in episode 1.
- H3: written lessons show up in behavior more often than not.

## Counts against
- No difference between reflect and nomemory across 20+ seeds.
- Equal improvement in nomemory (practice effect, not memory).
- Stated-action gaps outnumber enacted lessons.
- Dyad no better than single.
- Agreement mostly present before interaction.

## Uninformative
- Ceiling: near 100% on hardest items in episode 1 (the model likely knows the 2-4-6 task). Then switch to a novel task family.
- Parse failures above about 10% of turns.

## Run
`npm run batch -- --mode live --seeds 3 --conditions dyad-reflect,dyad-nomemory` (pilot), then 20 seeds.
