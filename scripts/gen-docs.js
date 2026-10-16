// Writes docs that are generated from code, so they cannot drift: docs/DATA_DICTIONARY.md and docs/HUMAN_COMPARISON.md.
// Run with: npm run docs. The test suite fails if either file is out of date.
import { writeFile } from 'node:fs/promises';
import { dictionaryMarkdown } from '../src/research/exports.js';
import { humanComparisonMarkdown } from '../src/research/human.js';

await writeFile(new URL('../docs/DATA_DICTIONARY.md', import.meta.url), dictionaryMarkdown());
await writeFile(new URL('../docs/HUMAN_COMPARISON.md', import.meta.url), humanComparisonMarkdown());
console.log('wrote docs/DATA_DICTIONARY.md and docs/HUMAN_COMPARISON.md');
