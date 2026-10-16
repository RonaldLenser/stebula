# Indicator scorecard

Indicator properties drawn from scientific theories, following the approach of Butlin, Long et al. (2023). Wording is a paraphrase from memory: verify against the paper. Status describes the Talk agent as built.

Count: 1 implemented, 6 partial analog, 6 absent, 1 cannot tell, of 14.

| ID | Theory | Requires | Status | Where in Stebula | What is missing |
|---|---|---|---|---|---|
| RPT-1 | Recurrent processing | Input modules with algorithmic recurrence | absent | | Model processes tokens feedforward |
| RPT-2 | Recurrent processing | Organized, integrated perceptual representations | absent | | No perception beyond text |
| GWT-1 | Global workspace | Multiple specialized systems in parallel | partial | Five thought processes each turn | Roles in one model call, not parallel systems |
| GWT-2 | Global workspace | Limited-capacity workspace, bottleneck, selective attention | implemented | 2 of 5 thoughts enter, chosen by code | Imposed by code, not emergent |
| GWT-3 | Global workspace | Global broadcast to all modules | partial | Winners go to speaking stage and next turn's processes | Speaking stage also sees the full conversation |
| GWT-4 | Global workspace | State-dependent attention, sequential querying | absent | | One competition per turn |
| HOT-1 | Higher-order | Generative, top-down or noisy perception | absent | | Not addressed |
| HOT-2 | Higher-order | Metacognitive monitoring of reliability | partial | Self-prediction tests and stability scores | Monitors answers, not perception |
| HOT-3 | Higher-order | Belief and action updating from monitoring | partial | Revisions, reflection, self-test results feed memory and attention | Updates are text, not model changes |
| HOT-4 | Higher-order | Sparse and smooth coding, quality space | cannot tell | | Model internals not inspectable |
| AST-1 | Attention schema | Model representing and controlling attention | partial | Sees what it attended to last turn; repeats penalized | Sees a record, does not model or control attention |
| PP-1 | Predictive processing | Input modules using predictive coding | absent | | Surprise comes from the conversation |
| AE-1 | Agency | Learning from feedback, pursuing competing goals | partial | Initiative pursues open questions; affect shifts which goals win | No learning in the model |
| AE-2 | Embodiment | Modeling output-input contingencies | absent | | No body or environment |

## Caveats (always show with the count)
- These theories disagree with each other. Satisfying some indicators does not establish consciousness, and the original authors say so.
- Most indicators concern computational architecture. Prompt-level analogs may not count on the theories in question.
- On views like IIT, this scorecard measures nothing.
