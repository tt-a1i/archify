import { execFile } from 'node:child_process';

// Keep the terminal's process group intact: an external group SIGKILL must
// still stop the coordinator and its workers together. Forwarding is idempotent
// because a terminal signal may already have reached the child directly.
export function createCommandCancellation() {
  let requested;
  let active;
  let stage = 'prepare';
  const onSignal = signal => {
    if (requested) return;
    requested = { signal, stage };
    active?.stop(signal);
  };
  const onInt = () => onSignal('SIGINT');
  const onTerm = () => onSignal('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);

  const interruptedResult = (at, result = {}) => {
    const signal = requested?.signal || result.signal;
    const interruption = {
      signal,
      stage: requested?.stage || at,
      origin: requested ? 'command' : 'child',
      forced: Boolean(result.forced),
    };
    const { forced: _forced, ...completed } = result;
    return { ...completed, status: signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1,
      stdout: result.stdout || '', stderr: result.stderr || '', interruption };
  };

  return {
    get requested() { return Boolean(requested); },
    interruptedResult,
    async checkpoint(at) {
      stage = at;
      await new Promise(resolve => setImmediate(resolve));
      return requested ? interruptedResult(at) : null;
    },
    run(at, args, { cwd = process.cwd(), env = process.env, maxBuffer = 64 * 1024 * 1024, coordinator = false } = {}) {
      if (requested) return Promise.resolve(interruptedResult(at));
      stage = at;
      return new Promise(resolve => {
        let timer;
        let forced = false;
        const child = execFile(process.execPath, args, { cwd, env, encoding: 'utf8', maxBuffer }, (error, stdout, stderr) => {
          clearTimeout(timer);
          active = undefined;
          // Preserve the existing checker-output-limit contract when switching
          // from spawnSync to execFile. Never reinterpret truncated JSON.
          const outputLimit = error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
          const result = { stdout, stderr, signal: error?.signal || null,
            status: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
            ...(error && (!Number.isInteger(error.code) && !error.signal || outputLimit)
              ? { error: outputLimit ? Object.assign(error, { code: 'ENOBUFS' }) : error } : {}),
            ...(forced ? { forced: true } : {}),
          };
          resolve(requested || result.signal && !outputLimit ? interruptedResult(at, result) : result);
        });
        active = {
          stop(signal) {
            if (child.exitCode === null && child.signalCode === null) child.kill(signal);
            // Coordinators need time for their worker's bounded stop and the
            // existing ownership-aware failure protocol before escalation.
            timer = setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) {
                forced = true;
                child.kill('SIGKILL');
              }
            }, coordinator ? 5000 : 2000);
          },
        };
      });
    },
    dispose() {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
    },
  };
}

export function interruptionFailure(result, subject = {}) {
  const { signal, stage, origin, forced } = result.interruption;
  const error = `The ${stage} operation was interrupted (${signal}); it did not produce a passing verdict.`;
  return { error, status: result.status, diagnostics: [{
    code: 'cli/interrupted', severity: 'error', message: error,
    subject: { ...subject, stage },
    evidence: { signal, origin, forced, inspectionComplete: false },
    supportedFixes: [
      'Wait for this command to exit, then rerun the original command; no diagram edit is required for an interruption.',
      'If recovery or a stale lock is reported, follow that specific diagnostic before retrying. Preserve the artifact, provenance, pending journal and any retained recovery data.',
    ],
  }] };
}
