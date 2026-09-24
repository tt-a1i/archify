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

function run(args, { cwd, env }) {
  return new Promise((resolve) => {
    execFile(process.execPath, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout) => resolve({ status: error ? (error.code ?? 1) : 0, stdout }));
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

export async function reduceCrossings({
  cliPath, candidate, quality = 'showcase', cwd, env,
  workers = 4, maxTrials = 64, budgetMs = 20000,
}) {
  const started = Date.now();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-route-'));
  let serial = 0;
  let trials = 0;
  const measure = async (trial) => {
    const id = serial++;
    const input = path.join(directory, `${id}.json`);
    const output = path.join(directory, `${id}.html`);
    fs.writeFileSync(input, JSON.stringify(trialCopy(trial, output)));
    const rendered = await run([cliPath, 'render', 'architecture', input, output, '--quality', quality], { cwd: directory, env });
    if (rendered.status !== 0) return null;
    const checked = await run([cliPath, 'check', output, '--json'], { cwd: directory, env });
    let receipt;
    try { receipt = JSON.parse(checked.stdout); } catch { return null; }
    const composition = receipt.composition;
    if (!receipt.ok || composition?.status !== 'pass' || composition.issues?.length) return null;
    const review = composition.routeReview || { crossings: [], detours: [] };
    return { crossings: review.crossings.length, detours: review.detours.length, pairs: review.crossings };
  };
  try {
    let best = { candidate, measured: await measure(candidate) };
    const initial = best.measured;
    if (!initial?.crossings) return null;
    const changes = new Map();
    for (let pass = 0; pass < 2 && best.measured.crossings; pass += 1) {
      let improved = false;
      const ids = [...new Set(best.measured.pairs.flatMap((pair) => [pair.left.id, pair.right.id]))];
      for (const id of ids) {
        const edge = best.candidate.connections?.find((entry) => entry.id === id);
        if (!id || !adjustable(edge) || changes.has(id)) continue;
        const options = SIDES.flatMap((fromSide) => SIDES.map((toSide) => ({ fromSide, toSide })));
        let local = null;
        for (let index = 0; index < options.length; index += workers) {
          if (trials >= maxTrials || Date.now() - started > budgetMs) break;
          const batch = options.slice(index, index + workers);
          trials += batch.length;
          const results = await Promise.all(batch.map(async (sides) => {
            const trial = structuredClone(best.candidate);
            Object.assign(trial.connections.find((entry) => entry.id === id), sides);
            return { trial, sides, measured: await measure(trial) };
          }));
          for (const result of results) {
            const reference = local?.measured || best.measured;
            if (result.measured && result.measured.crossings <= best.measured.crossings
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
      if (!improved) break;
    }
    if (!changes.size) return null;
    return {
      candidate: best.candidate,
      record: {
        crossings: [initial.crossings, best.measured.crossings],
        detours: [initial.detours, best.measured.detours],
        pinned: [...changes].map(([id, sides]) => ({ id, ...sides })),
        trials,
        durationMs: Date.now() - started,
      },
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
