// Runs every test file in order and stops at the first failure.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const files = ['selftest.js', ...readdirSync(dir).filter(f => /^test-.+\.js$/.test(f)).sort()];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`FAILED: ${f}`); process.exit(r.status || 1); }
}
console.log(`all ${files.length} test files passed`);
