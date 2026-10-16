# Experiment 04: Isolation and social development

Status: BUILT (prompt 3, hardened in the audit response).

## Design
Four variants, same checkpoints (personality questions, self-prediction tests):
- Isolated: reading only, no conversation
- Social: conversation only, no reading
- Mixed: both
- Baseline: nothing

Same books, same conversation scripts where possible.

Checkpoints are assessments on a snapshot of each agent's memory, so assessing an agent never changes it (the baseline included). The protocol and predictions are written before the first model call. A condition with a failed step is excluded, not counted.

## Measures
Self-model size and revision rate, trait formation speed and divergence, self-prediction accuracy, said-vs-shown gaps, initiative rate, questions asked.

## Human comparison
Social deprivation and sensitive periods (Bucharest Early Intervention Project; Harlow). Key difference: the base model was trained on vast human social data, so no variant is truly isolated. This tests isolation of experience after "birth," not of origins.

## Ethics note
These experiments would be unethical on people. Whether they raise welfare questions for AI systems is an open question in the field. Keep runs purposeful and record why each is run.
