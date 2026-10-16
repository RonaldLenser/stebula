# Limitations

Read this before citing any result from this repo.

1. **Nothing here measures subjective experience.** The project measures memory, belief revision, consistency between stated beliefs and decisions, transfer, recognition of limits, and synthesis quality. No consciousness score exists here, by design.
2. **All change is external.** Memory is text pasted into prompts. Model weights never change. "Growth" means a different prompt produced different behavior.
3. **Two agents, one model.** Both agents are the same underlying model with different instructions. Agreement may come from shared training, not dialogue. Round 1 is independent so this can be partly measured (shared-prior flag), not removed.
4. **Self-reports are generated text.** "I feel", "I realized", "my reasoning was" are outputs, not readouts of internal computation. Stated reasons can be unfaithful to what actually drove an answer (Turpin et al. 2023). Decision summaries in this app are summaries, not windows.
5. **Contamination and ceilings.** The model has likely read about Wason's 2-4-6 task and positive-test bias. Episode 1 may already be at ceiling, which makes the experiment uninformative.
6. **Near transfer only.** Episode 2 is a different rule from the same small library. Transfer to genuinely different problems is untested.
7. **Crude text measures.** Hypothesis revisions are detected by content-word overlap. Rewording can look like revision, and real change in similar words can be missed. Evaluator checks are regex and thresholds; they miss things and misfire. Every flag shows its evidence so a person can overrule it.
8. **Modeled affect is a label on arithmetic.** "Surprise" is the recent prediction-failure rate. Calling it an arousal analog is a modeling choice, not a finding about feeling.
9. **Mock mode proves nothing.** Its improvement is coded in. It exists so the app runs without a key and the pipeline can be tested.
10. **Small samples, correlated runs.** Agents in a dyad share a conversation, so their scores are not independent. Intervals in the batch report are rough.
11. **Live runs are not exactly reproducible.** Sampling temperature makes model output vary. The event log, not the seed, is the record. Tasks and mock behavior are seeded and reproducible.
12. **Persona confound.** Personas (empiricist, analogist) shape behavior. Neither is told to falsify, so a falsification strategy has to come from experience, but persona wording still matters and should be varied in later runs.
13. **Talk is a conversation with a language model plus a memory file.** Its "continuity" is the file. Between messages nothing runs. A richer self-model in that file is a richer description, not evidence of a self.
14. **The honesty instruction shapes the answers.** Telling it to stay uncertain about experience makes uncertain answers more likely. That is a deliberate choice to avoid scripting either a claim or a denial, but it is still a choice, and it is visible in `src/talk/prompts.js`.
15. **The auditor is the same model family.** It shares blind spots with the agent. Treat audits as a second opinion, not a verdict.
16. **Talk checks are pattern matching.** "I feel like that argument fails" gets flagged as a possible self-report. Quotes are shown so you can judge.
17. **The workspace bottleneck is imposed, not emergent.** Code picks 2 of 5 thoughts. The five "processes" are roles in one model call, and the speaking stage still sees the whole conversation.
18. **Affect weights were chosen by hand.** The boost sizes (0.4) and repetition penalty (0.3) are design choices, not fitted to anything. They demonstrably change which thoughts win; that is all they show.
19. **Self-prediction has an easy exploit.** If it always predicts and answers "unsure", it scores well while knowing little. The app shows the stance distribution so this is visible.
20. **"Between sessions" means on return.** Reflection runs when you reopen Talk after 30 minutes. Nothing happens in the gap.
21. **The scorecard grades analogs.** A prompt-level analog of an architectural property may not count on the theory it comes from.
22. **The brain view is a diagram.** The five regions are software roles in prompts and code, placed on a brain shape for readability. Position and shape carry no meaning. Glow is the recorded workspace score; nothing is a scan of the model.
