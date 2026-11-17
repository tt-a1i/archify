import { createHash } from 'node:crypto';

// The offline browser and Node hash the same canonical selection. Keep the
// original ID format, including for tasks exported by older workbenches.
export function createTaskId(sha256) {
  return function taskIdOf(selected) {
    const identity = selected.map((d) => [d.id, d.evidenceDigest?.sha256 || null, ...(d.external ? [d.external.reviewDigest] : [])])
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const format = (digest) => `TASK-${digest.slice(0, 12)}`;
    const digest = sha256(JSON.stringify(identity));
    return typeof digest === 'string' ? format(digest) : digest.then(format);
  };
}

export const taskIdOf = createTaskId((text) => createHash('sha256').update(text).digest('hex'));
