# Hypothesis protocol

How every hypothesis in Stebula is proposed, tested, and recorded.

1. **Propose.** A hypothesis can come from Ron, from Claude, or from the "Generate hypotheses" button. It must include: statement, the data that suggested it (record ids), a prediction, the metric that tests it, the result that would refute it, and the result that would be uninformative.
2. **Lock.** The prediction is locked before any test data is collected. It can never be edited afterward. A changed idea is a new version with a new id.
3. **Test.** Code runs the test when the metric is computable from the record. Otherwise the hypothesis is marked "needs experiment" with a design.
4. **Record.** Status: proposed, testing, exploratory, inconclusive, pilot-consistent, pilot-inconsistent. These are descriptive pilot labels, not verdicts, until a protocol has an uncertainty-aware decision rule. A result measured on data that existed before the prediction was locked is exploratory and cannot confirm. Store numbers, sample size, date, and the record ids used.
5. **Compare.** Every finding gets a human comparison: matched research area, what humans show, what Stebula shows, key difference.
6. **Report proportionally.** One run is an anecdote. Pilot results are labeled pilot. Null results are reported.

## Example
- Statement: Reading a story about disobedience raises a "rule-questioning" trait more than reading a story about love.
- Prediction (locked): After 1 full read-through, Agent A (Peter Rabbit) has rule-questioning strength at least 0.2 higher than Agent B (Velveteen Rabbit).
- Metric: trait strength from the personality model, plus the behavioral proxy (challenges to the person per turn).
- Counts against it if: the difference is under 0.1, or appears equally in a fresh baseline.
- Uninformative if: neither agent forms any trait.
