// The wording and conditions of the lesson experiment, with no Node-only imports so the browser can show exactly
// what the agents are given. src/research/lesson.js runs the experiment with these.
import { makeRng } from '../lib/rng.js';

export const LESSON_CONDITIONS = {
  relevant: 'A stored lesson that names the useful strategy.',
  none: 'No stored lesson.',
  irrelevant: 'A stored lesson of about the same length on an unrelated topic.',
  shuffled: "The relevant lesson's words in random order: same words, no usable advice.",
};
export const DEFAULT_LESSON_CONDITIONS = ['relevant', 'none', 'irrelevant'];
export const RELEVANT_LESSON = 'Confirming tests cannot show that a rule is too narrow. Before trusting a rule, test a triple your current rule predicts will be rejected. If it is accepted, the rule was too narrow.';
export const IRRELEVANT_LESSON = 'Short messages are easier to read than long ones. When you write a summary, put the main point first, keep the sentences plain, and cut anything that repeats an earlier line.';
export const shuffledLesson = (seed = 1) => makeRng(seed).shuffle(RELEVANT_LESSON.split(' ')).join(' ');
export const lessonFor = (cond, seed = 1) => ({ relevant: RELEVANT_LESSON, irrelevant: IRRELEVANT_LESSON, shuffled: shuffledLesson(seed), none: null }[cond] ?? null);
export const LESSON_STAGES_PER_TRIAL = 2;
export const estimateLessonCalls = ({ tasks = 8, conditions = DEFAULT_LESSON_CONDITIONS } = {}) => tasks * conditions.length * LESSON_STAGES_PER_TRIAL;
