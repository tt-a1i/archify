// Searches endpoint sides for automatic Architecture relationships that still
// cross after a passing finalize. Node positions, sizes and every authored
// route stay as they are: only relationships the author left to the router get
// explicit fromSide/toSide, and a trial counts only when the complete
// render-and-check pass still has no composition issue. finalize reruns every
// gate on the chosen candidate and restores the draft if that fails.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SIDES = ['top', 'right', 'bottom', 'left'];

// Each child gets only the time left in the safety budget. A child stopped by
// that limit marks the whole search as cut short: its result is discarded, so
// how fast the machine is never decides which candidate is chosen.
function run(args, { cwd, env, timeout }) {
  if (timeout <= 0) return Promise.resolve({ status: 1, stdout: '', timedOut: true });
  return new Promise((resolve) => {
    execFile(process.execPath, args, { cwd, env, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout) => resolve({ status: error ? (error.code ?? 1) : 0, stdout, timedOut: Boolean(error?.killed) }));
  });
}

// Geometry does not depend on source evidence, so trials render a copy without
// it and need no repository access.
function trialCopy(candidate, output) {
  const copy = structuredClone(candidate);
  delete copy.meta.repository;
  copy.meta.output = path.basename(output);
  for (const component of copy.components || []) delete component.sources;
  return copy;
}

function adjustable(edge) {
  return edge && !edge.fromSide && !edge.toSide && !edge.via && !edge.labelAt
    && (!edge.route || edge.route === 'auto') && edge.channelX === undefined && edge.channelY === undefined;
}

const score = (m) => m.crossings * 3 + m.detours;
const SIDE_OPTIONS = SIDES.flatMap((fromSide) => SIDES.map((toSide) => ({ fromSide, toSide })));

// Automatic relationships named by the crossings, in the order the check
// reported them, so every run searches the same variants in the same order.
function crossingIds(candidate, pairs = []) {
  const ids = [...new Set(pairs.flatMap((pair) => [pair?.left?.id, pair?.right?.id]))];
  return ids.filter((id) => id && adjustable(candidate.connections?.find((entry) => entry.id === id)));
}

// Returns { candidate, record }. candidate is null when the draft keeps its
// routes; record then says why (`reason`) and what the search cost, so a
// search that changed nothing is still visible in the finalize receipt.
// The search is bounded by trial count, which makes it reproducible; budgetMs
// is only a safety stop, and a search that reaches it changes nothing.
export async function reduceCrossings({
  cliPath, candidate, quality = 'showcase', cwd, env, crossings,
  workers = 4, maxTrials = 32, budgetMs = 60000,
}) {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const unchanged = (reason, extra = {}) => ({ candidate: null, record: { reason, trials: 0, durationMs: elapsed(), ...extra } });
  // Searches that cannot finish inside the trial limit are not started.
  if (crossings) {
    const ids = crossingIds(candidate, crossings);
    if (!ids.length) return unchanged('no-adjustable-relationship', { crossings: [crossings.length, crossings.length] });
    if (ids.length * SIDE_OPTIONS.length > maxTrials) {
      return unchanged('search-too-large', { crossings: [crossings.length, crossings.length], adjustable: ids.length });
    }
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-route-'));
  let serial = 0;
  let trials = 0;
  let cutShort = false;
  const measure = async (trial) => {
    const id = serial++;
    const input = path.join(directory, `${id}.json`);
    const output = path.join(directory, `${id}.html`);
    fs.writeFileSync(input, JSON.stringify(trialCopy(trial, output)));
    const rendered = await run([cliPath, 'render', 'architecture', input, output, '--quality', quality], { cwd: directory, env, timeout: budgetMs - elapsed() });
    if (rendered.timedOut) cutShort = true;
    if (rendered.status !== 0) return null;
    const checked = await run([cliPath, 'check', output, '--json'], { cwd: directory, env, timeout: budgetMs - elapsed() });
    if (checked.timedOut) cutShort = true;
    let receipt;
    try { receipt = JSON.parse(checked.stdout); } catch { return null; }
    const composition = receipt.composition;
    if (!receipt.ok || composition?.status !== 'pass' || composition.issues?.length) return null;
    const review = composition.routeReview || { crossings: [], detours: [] };
    return { crossings: review.crossings.length, detours: review.detours.length, pairs: review.crossings };
  };
  try {
    const initial = await measure(candidate);
    if (cutShort) return unchanged('time-limit', { trials });
    if (!initial?.crossings) return unchanged('no-crossing');
    let best = { candidate, measured: initial };
    const changes = new Map();
    for (let pass = 0; pass < 2 && best.measured.crossings; pass += 1) {
      let improved = false;
      for (const id of crossingIds(best.candidate, best.measured.pairs)) {
        if (changes.has(id)) continue;
        let local = null;
        for (let index = 0; index < SIDE_OPTIONS.length && trials < maxTrials; index += workers) {
          const batch = SIDE_OPTIONS.slice(index, Math.min(index + workers, index + maxTrials - trials));
          trials += batch.length;
          const results = await Promise.all(batch.map(async (sides) => {
            const trial = structuredClone(best.candidate);
            Object.assign(trial.connections.find((entry) => entry.id === id), sides);
            return { trial, sides, measured: await measure(trial) };
          }));
          if (cutShort) {
            return unchanged('time-limit', { trials, crossings: [initial.crossings, initial.crossings] });
          }
          // Results are judged in option order, whichever child finished first.
          for (const result of results) {
            const reference = local?.measured || best.measured;
            // A variant may not add a detour: a long way round reads worse than
            // the crossing it removes, and crossings beside an arrowhead are
            // not counted, so a detour can hide one.
            if (result.measured && result.measured.crossings <= best.measured.crossings
                && result.measured.detours <= best.measured.detours
                && score(result.measured) < score(reference)) local = result;
          }
        }
        if (local) {
          best = { candidate: local.trial, measured: local.measured };
          changes.set(id, local.sides);
          improved = true;
          if (!best.measured.crossings) break;
        }
      }
      // A pass that improved nothing ends the search.
      if (!improved) break;
    }
    const record = {
      crossings: [initial.crossings, best.measured.crossings],
      detours: [initial.detours, best.measured.detours],
      trials,
      durationMs: elapsed(),
    };
    if (!changes.size) return { candidate: null, record: { reason: 'no-improvement', ...record } };
    return {
      candidate: best.candidate,
      record: { ...record, pinned: [...changes].map(([id, sides]) => ({ id, ...sides })) },
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
