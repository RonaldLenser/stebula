// Tracks work that is in progress (turns, readings, experiments) so the server can
//  - cancel it when the browser disconnects or the person presses Stop,
//  - refuse to restart while it runs, and
//  - stop it cleanly on shutdown.
// Cancelling aborts the signal that every model call checks, so no further calls are made.
export function makeJobs() {
  const active = new Map();
  let seq = 0;
  return {
    // `res` (optional): abort the job if the connection closes before the response finished.
    begin(label, res = null) {
      const id = ++seq, ac = new AbortController(), job = { id, label, startedAt: Date.now(), signal: ac.signal, state: 'running' };
      active.set(id, { job, ac });
      const onClose = () => { if (!res.writableFinished && !ac.signal.aborted) { job.state = 'cancelled'; ac.abort(new Error('client disconnected')); } };
      res?.on('close', onClose);
      job.end = (state = 'done') => { if (job.state === 'running') job.state = state; active.delete(id); res?.off('close', onClose); };
      job.abort = () => { job.state = 'cancelled'; ac.abort(new Error('cancelled')); };
      return job;
    },
    count: () => active.size,
    list: () => [...active.values()].map(({ job }) => ({ id: job.id, label: job.label, seconds: Math.round((Date.now() - job.startedAt) / 1000), state: job.state })),
    cancel(id) { const e = active.get(Number(id)); if (!e) return false; e.job.abort(); return true; },
    abortAll() { for (const { job } of active.values()) job.abort(); },
    // Resolves when nothing is running, or after `ms`.
    async idle(ms = 8000) { const t0 = Date.now(); while (active.size && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 50)); return active.size === 0; },
  };
}
