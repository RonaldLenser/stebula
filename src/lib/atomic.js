// Write to a temp file in the same folder, then rename over the target, so a crash never leaves a half-written file.
import { writeFile, rename, rm } from 'node:fs/promises';

export async function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    await writeFile(tmp, text);
    for (let i = 0; ; i++) {
      try { await rename(tmp, file); return; }
      catch (e) { if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; await new Promise(r => setTimeout(r, 40 * (i + 1))); } // Windows can briefly lock the target
    }
  } catch (e) { await rm(tmp, { force: true }).catch(() => {}); throw e; }
}
