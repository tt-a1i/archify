#!/usr/bin/env node
// Differential fuzzing for the compatibility claim: a document that declares
// none of the new positions must come out of this revision's compiler exactly
// as it came out of a base revision's compiler.
//
// The base revision's compiler is the oracle. A document it accepts, the
// candidate must accept and draw byte for byte; a document it rejects, the
// candidate must reject too. Determinism is checked as the premise the whole
// method rests on: the same document twice, the same bytes.
//
// Usage: node scripts/fuzz-legacy-equivalence.mjs [--base <rev>] [--count N] [--seed N]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const skillRoot = path.join(repoRoot, 'archify');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const base = option('--base', 'HEAD~1');
const count = Number(option('--count', '1500'));
const seed = Number(option('--seed', '1'));

// deterministic PRNG, so a failing case can be replayed from its seed
function rng(initial) {
  let state = initial >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const pick = (random, list) => list[Math.floor(random() * list.length) % list.length];
const word = (random, min, max) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789 '.split('');
  const length = min + Math.floor(random() * (max - min + 1));
  let out = '';
  for (let i = 0; i < length; i += 1) out += pick(random, alphabet);
  return out;
};

const KINDS = ['frontend', 'backend', 'security', 'messagebus', 'database', 'cloud', 'external'];
const VARIANTS = [undefined, 'emphasis', 'security', 'dashed'];

// Only the positions the base revision already knows: no facts, links, media,
// types, labels, rules, edge states, bands or reader.
function document(random, index) {
  const lanes = [];
  const nodes = [];
  const edges = [];
  for (let lane = 0; lane < 1 + Math.floor(random() * 4); lane += 1) {
    const laneId = 'lane' + lane;
    lanes.push({ id: laneId, label: word(random, 1, 12) });
    const stops = 1 + Math.floor(random() * 6);
    const columns = [0, 1, 2, 3, 4, 5].sort(() => random() - 0.5).slice(0, stops).sort((a, b) => a - b);
    let previous = null;
    for (let stop = 0; stop < stops; stop += 1) {
      const id = 'n' + lane + '_' + stop;
      nodes.push({
        id,
        lane: laneId,
        col: columns[stop],
        type: pick(random, KINDS),
        label: word(random, 1, 14),
        width: 72 + Math.floor(random() * 120),
        ...(random() < 0.4 ? { sublabel: word(random, 1, 20) } : {}),
        ...(random() < 0.2 ? { tag: word(random, 1, 8) } : {}),
      });
      if (previous) {
        edges.push({
          id: 'e' + lane + '_' + stop,
          from: previous,
          to: id,
          label: word(random, 1, 10),
          ...(random() < 0.3 ? { variant: pick(random, VARIANTS) } : {}),
        });
      }
      previous = id;
    }
    if (stops > 1 && random() < 0.3) {
      edges.push({ id: 'r' + lane, from: previous, to: 'n' + lane + '_0', label: word(random, 1, 8), route: 'bottom-channel' });
    }
  }
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'fuzz-' + index, quality_profile: random() < 0.5 ? 'standard' : 'showcase' },
    lanes,
    nodes,
    edges,
    cards: [],
  };
}

const outcome = (module, spec) => {
  const compiled = module.compileWorkflow({ workflow: JSON.parse(JSON.stringify(spec)) });
  const diagnostics = compiled.diagnostics || (compiled.receipt && compiled.receipt.diagnostics) || [];
  return { ok: Boolean(compiled.ok), svg: compiled.svg || '', runtime: compiled.runtime || '', codes: diagnostics.map((d) => d.code).join(',') };
};

// The base compiler is the oracle, so it runs against the base revision's own
// dependency tree: staged alone it would import this branch's ../shared modules,
// which could move both compilers and hide the difference the run exists to find.
// A detached worktree gives it its own imports; it is removed again whatever happens.
const baseTree = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-fuzz-base-'));
try {
  execFileSync('git', ['worktree', 'add', '--detach', baseTree, base], { cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'] });
} catch (error) {
  fs.rmSync(baseTree, { recursive: true, force: true });
  console.error('cannot check out base revision ' + base + ' as a worktree: ' + (error && error.message ? error.message : error));
  process.exit(1);
}
const baseCompiler = path.join(baseTree, 'archify', 'renderers', 'workflow', 'workflow-compiler.mjs');
let differing = 0;
try {
  const upstream = await import(pathToFileURL(baseCompiler).href + '?v=' + Date.now());
  const current = await import(pathToFileURL(path.join(skillRoot, 'renderers', 'workflow', 'workflow-compiler.mjs')).href);
  const random = rng(seed);
  let accepted = 0;
  let rejected = 0;
  const firstDifferences = [];
  for (let index = 0; index < count; index += 1) {
    const spec = document(random, index);
    const before = outcome(upstream, spec);
    const after = outcome(current, spec);
    if (!before.ok) {
      rejected += 1;
      if (after.ok) differing += 1;
      else continue;
    } else {
      accepted += 1;
      if (after.ok && after.svg === before.svg && after.runtime === before.runtime) continue;
      differing += 1;
    }
    if (firstDifferences.length < 3) {
      firstDifferences.push({ index, base: { ok: before.ok, codes: before.codes, bytes: before.svg.length }, candidate: { ok: after.ok, codes: after.codes, bytes: after.svg.length } });
    }
  }
  let unstable = 0;
  const deterministic = rng(seed + 1);
  for (let index = 0; index < Math.min(200, count); index += 1) {
    const spec = document(deterministic, index);
    const once = outcome(current, spec);
    const twice = outcome(current, spec);
    if (once.svg !== twice.svg || once.runtime !== twice.runtime || once.ok !== twice.ok) unstable += 1;
  }
  console.log('base ' + base + ', candidate ' + execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim() + ', seed ' + seed);
  console.log('  documents generated      : ' + count + ' (none declares any new position)');
  console.log('  base accepted            : ' + accepted + '  (all must match byte for byte)');
  console.log('  base rejected            : ' + rejected + '  (the candidate must reject them too)');
  console.log('  differences              : ' + differing);
  console.log('  determinism failures     : ' + unstable + ' of ' + Math.min(200, count) + ' compiled twice');
  if (firstDifferences.length) console.log('  first differences        : ' + JSON.stringify(firstDifferences));
  process.exitCode = differing === 0 && unstable === 0 ? 0 : 1;
} finally {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', baseTree], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });
  } catch {
    execFileSync('git', ['worktree', 'prune'], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  fs.rmSync(baseTree, { recursive: true, force: true });
}
