// Indicator properties for consciousness drawn from scientific theories, following the
// approach of Butlin, Long et al. (2023). Wording here is a paraphrase written from memory:
// VERIFY against the paper before citing. Status describes THIS app, honestly.
export const INDICATORS = [
  { id: 'RPT-1', theory: 'Recurrent processing', text: 'Input modules that use algorithmic recurrence', status: 'absent', where: null, gap: 'The underlying model processes each token feedforward. Threshold adds no recurrence to perception.' },
  { id: 'RPT-2', theory: 'Recurrent processing', text: 'Input modules that generate organized, integrated perceptual representations', status: 'absent', where: null, gap: 'There is no perception beyond reading text.' },
  { id: 'GWT-1', theory: 'Global workspace', text: 'Multiple specialized systems that can operate in parallel', status: 'partial', where: 'Five thought processes (perception, memory, self-monitor, evaluation, initiative) each propose a thought every turn.', gap: 'They are roles inside one model call, not separate systems running in parallel.' },
  { id: 'GWT-2', theory: 'Global workspace', text: 'A limited-capacity workspace, creating a bottleneck and selective attention', status: 'implemented', where: 'Only 2 of 5 thoughts enter the workspace, chosen by code. Losers are dropped and logged.', gap: 'The bottleneck is imposed by code on text, not an emergent property of the system.' },
  { id: 'GWT-3', theory: 'Global workspace', text: 'Global broadcast: workspace contents available to all modules', status: 'partial', where: 'Winning thoughts are passed to the speaking stage and shown to all processes next turn.', gap: 'The speaking stage also sees the full conversation, so the workspace is not the only route for information.' },
  { id: 'GWT-4', theory: 'Global workspace', text: 'State-dependent attention, using the workspace to query modules in sequence for complex tasks', status: 'absent', where: null, gap: 'One competition per turn. No sequential querying.' },
  { id: 'HOT-1', theory: 'Higher-order', text: 'Generative, top-down or noisy perception modules', status: 'absent', where: null, gap: 'Not addressed.' },
  { id: 'HOT-2', theory: 'Higher-order', text: 'Metacognitive monitoring that distinguishes reliable representations from noise', status: 'partial', where: 'Self-prediction tests score whether it knows how it will answer, and whether its own answers are stable.', gap: 'Monitors its answers about statements, not its perceptual representations.' },
  { id: 'HOT-3', theory: 'Higher-order', text: 'Belief formation and action selection that update in line with metacognitive monitoring', status: 'partial', where: 'Self-model revisions, between-session reflection, and self-test results feed back into memory and attention.', gap: 'Updates are text in a memory file, not changes to the model.' },
  { id: 'HOT-4', theory: 'Higher-order', text: 'Sparse and smooth coding generating a quality space', status: 'unknown', where: null, gap: 'Concerns the model\'s internal representations, which Threshold cannot inspect.' },
  { id: 'AST-1', theory: 'Attention schema', text: 'A predictive model representing and controlling the current state of attention', status: 'partial', where: 'Each turn the agent is shown what reached its attention last turn, and repeated thoughts are penalized.', gap: 'It sees a record of attention; it does not model or control attention itself.' },
  { id: 'PP-1', theory: 'Predictive processing', text: 'Input modules that use predictive coding', status: 'absent', where: null, gap: 'Surprise is computed from the conversation, not from prediction error inside perception.' },
  { id: 'AE-1', theory: 'Agency', text: 'Learning from feedback and selecting outputs to pursue goals, balancing competing goals', status: 'partial', where: 'Initiative thoughts pursue its open questions; affect shifts which goals win.', gap: 'No learning in the model. Goals are text it wrote.' },
  { id: 'AE-2', theory: 'Embodiment', text: 'Modeling how outputs affect inputs, and using that model in perception or control', status: 'absent', where: null, gap: 'No body and no environment beyond the conversation.' },
];

export const SCORECARD_CAVEATS = [
  'These indicators come from theories that disagree with each other. Satisfying some does not establish consciousness, and the original authors say as much.',
  'Most indicators concern computational architecture. Stebula implements analogs at the level of prompts and code around a model, which may not count at all on the theories in question.',
  'Some theories, such as integrated information theory, say behavior and software organization are irrelevant to consciousness. On those views this scorecard measures nothing.',
  'The list and wording are a paraphrase written from memory. Verify against Butlin, Long et al. (2023) before citing.',
];
