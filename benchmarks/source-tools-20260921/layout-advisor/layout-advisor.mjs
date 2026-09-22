#!/usr/bin/env node
// Experimental, offline-only grid advice. It never selects rows/columns or
// rewrites diagram semantics; the author supplies the grid cells.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { minimumNodeTextWidth } from '../../../archify/renderers/shared/text-fit.mjs';
import { gridLayout } from '../../../archify/renderers/architecture/grid.mjs';
import { textUnits } from '../../../archify/renderers/shared/utils.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const skill = path.join(root, 'archify');
const geometryKeys = new Set(['layout']);
const componentGeometryKeys = new Set(['pos', 'size', 'row', 'col']);
const metaGeometryKeys = new Set(['viewBox']);
const connectionCoordinateKeys = new Set(['via', 'channelX', 'channelY', 'labelAt', 'labelDx', 'labelDy', 'labelSegment']);
const componentFit = {
  labelEstimate: 6.6,
  sublabelMinimum: 6,
  tagMinimum: 6,
  componentPadding: 8,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function semanticProjection(value) {
  const projected = clone(value);
  for (const key of geometryKeys) delete projected[key];
  if (projected.meta) {
    for (const key of metaGeometryKeys) delete projected.meta[key];
  }
  for (const component of projected.components ?? []) {
    for (const key of componentGeometryKeys) delete component[key];
  }
  return projected;
}

function requiredWidth(component) {
  // Architecture's validation checks labels at 6.6px per text unit; use the
  // shared text-fit helpers for sublabels and tags, at their renderer minima.
  const label = Math.ceil(Math.max(0, textUnits(component.label ?? '')) * componentFit.labelEstimate);
  const sublabel = component.sublabel
    ? Math.ceil(minimumNodeTextWidth(component.sublabel, componentFit.sublabelMinimum) + componentFit.componentPadding)
    : 0;
  const tag = component.tag
    ? Math.ceil(minimumNodeTextWidth(component.tag, componentFit.tagMinimum) + componentFit.componentPadding)
    : 0;
  return Math.max(120, label, sublabel, tag);
}

function requiredHeight(component) {
  // The renderer's standard components are 60px tall; 64px leaves the normal
  // vertical room for the optional single-line sublabel/tag without claiming
  // a new text-layout model.
  return component.sublabel || component.tag ? 64 : 60;
}

function inputProblems(input) {
  const problems = [];
  if (input?.diagram_type !== 'architecture') problems.push('input diagram_type must be "architecture".');
  if (!Array.isArray(input?.components) || input.components.length === 0) problems.push('input needs at least one component.');
  const seen = new Set();
  const ids = new Set();
  for (const component of Array.isArray(input?.components) ? input.components : []) {
    if (!component || typeof component !== 'object' || Array.isArray(component)) {
      problems.push('every component must be an object.');
      continue;
    }
    if (typeof component.id !== 'string' || !component.id) problems.push('every component needs a non-empty id.');
    else if (ids.has(component.id)) problems.push(`components share id "${component.id}".`);
    else ids.add(component.id);
    if (!Number.isInteger(component.row) || component.row < 0 || !Number.isInteger(component.col) || component.col < 0) {
      problems.push(`component "${component.id ?? '<unknown>'}" needs author-selected non-negative integer row and col.`);
      continue;
    }
    const cell = `${component.row},${component.col}`;
    if (seen.has(cell)) problems.push(`components share author-selected grid cell ${cell}.`);
    seen.add(cell);
  }
  if (!Array.isArray(input?.connections)) problems.push('input connections must be an array.');
  for (const connection of Array.isArray(input?.connections) ? input.connections : []) {
    if (!connection || typeof connection !== 'object' || Array.isArray(connection)) continue;
    const pinned = [...connectionCoordinateKeys].filter((key) => connection[key] !== undefined);
    if (pinned.length) problems.push(`connection "${connection.id ?? '<unknown>'}" has absolute coordinate controls (${pinned.join(', ')}); advice cannot preserve them after a grid change.`);
  }
  return problems;
}

function makeCandidate(input, [gapX, gapY]) {
  const candidate = clone(input);
  const widths = candidate.components.map(requiredWidth);
  const heights = candidate.components.map(requiredHeight);
  const cols = Math.max(...candidate.components.map((component) => component.col)) + 1;
  const cellW = Math.max(...widths);
  const cellH = Math.max(...heights);

  // These are deliberately conservative fixed corridors, not a routing model.
  // Routing itself remains the production renderer's responsibility below.
  candidate.layout = {
    mode: 'grid',
    origin: [40, 80],
    cols,
    cellW,
    cellH,
    gapX,
    gapY,
  };
  if (candidate.meta) delete candidate.meta.viewBox;
  for (const component of candidate.components) {
    delete component.pos;
    component.size = [requiredWidth(component), requiredHeight(component)];
  }

  // Exercise the repository grid resolver here as an invariant, rather than
  // duplicating its default/merge behavior in this experiment.
  const resolvedGrid = gridLayout(candidate);
  if (!resolvedGrid || resolvedGrid.cols !== cols) throw new Error('candidate grid could not be resolved by Archify.');
  return candidate;
}

function parseReceipt(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function runValidate(candidate, { repoRoot } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-layout-advisor-'));
  const input = path.join(temp, 'candidate.architecture.json');
  const candidateText = `${JSON.stringify(candidate, null, 2)}\n`;
  fs.writeFileSync(input, candidateText);
  const candidateSha256 = createHash('sha256').update(candidateText).digest('hex');
  try {
    // --layout-json runs the production architecture renderer, including its
    // automatic router and label placer, before the ordinary artifact checks.
    const repoArgs = repoRoot ? ['--repo-root', path.resolve(repoRoot)] : [];
    const layout = spawnSync(process.execPath, [path.join(skill, 'bin/archify.mjs'), 'validate', 'architecture', input, '--layout-json', ...repoArgs], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
    });
    const validation = spawnSync(process.execPath, [path.join(skill, 'bin/archify.mjs'), 'validate', 'architecture', input, '--quality', 'showcase', '--json', ...repoArgs], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
    });
    const detail = (processResult) => ({
      exitCode: processResult.status,
      signal: processResult.signal,
      stdout: processResult.stdout?.trim() || '',
      stderr: processResult.stderr?.trim() || '',
    });
    const layoutReceipt = parseReceipt(layout.stdout);
    const validationReceipt = parseReceipt(validation.stdout);
    const layoutOk = layout.status === 0
      && layoutReceipt?.ok === true
      && layoutReceipt.diagram_type === 'architecture'
      && Array.isArray(layoutReceipt.components)
      && Array.isArray(layoutReceipt.connections);
    const validationOk = validation.status === 0
      && validationReceipt?.ok === true
      && validationReceipt.command === 'validate'
      && validationReceipt.candidate?.sha256 === candidateSha256
      && validationReceipt.composition?.profile === 'showcase'
      && validationReceipt.composition?.summary?.errors === 0
      && validationReceipt.composition?.summary?.warnings === 0
      && Array.isArray(validationReceipt.checks)
      && validationReceipt.checks.length >= 9
      && validationReceipt.checks.every((check) => check?.ok === true);
    return {
      ok: layoutOk && validationOk,
      candidateSha256,
      checks: validationOk ? { count: validationReceipt.checks.length, profile: validationReceipt.composition.profile } : null,
      layout: detail(layout), validation: detail(validation),
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

// Predeclared offline follow-up recipes, not learned from author reruns.
const gapRecipes = [[48, 72], [64, 72], [48, 88], [64, 88], [80, 72], [48, 104], [80, 104]];

export function advise(input, { repoRoot, searchGaps = false } = {}) {
  const problems = inputProblems(input);
  if (problems.length) return { status: 'declined', reasons: problems };
  let quality;
  const attempts = [];
  try {
    for (const gaps of searchGaps ? gapRecipes : gapRecipes.slice(0, 1)) {
      const candidate = makeCandidate(input, gaps);
      if (JSON.stringify(semanticProjection(input)) !== JSON.stringify(semanticProjection(candidate))) {
        throw new Error('advisor changed non-geometry semantics.');
      }
      quality = runValidate(candidate, { repoRoot });
      const receipt = parseReceipt(quality.validation.stdout);
      attempts.push({ gapX: gaps[0], gapY: gaps[1], ok: quality.ok,
        diagnosticCodes: [...new Set((receipt?.diagnostics ?? []).map((item) => item.code))] });
      if (quality.ok) return {
        status: 'advised', candidate, attempts,
        advice: {
          layout: candidate.layout,
          componentSizes: Object.fromEntries(candidate.components.map((component) => [component.id, component.size])),
        },
        quality,
      };
    }
  } catch (error) {
    return { status: 'declined', reasons: [`advisor could not safely prepare a candidate: ${error.message}`], attempts };
  }
  return { status: 'declined',
    reasons: ['candidate did not pass the production renderer/router and showcase validation.'],
    attempts, quality };
}

function usage() {
  return 'Usage: node layout-advisor.mjs <author-grid.architecture.json> [--repo-root <repository>] [--search-gaps] [--out <candidate.json>]';
}

function main(args) {
  const [inputPath, ...rest] = args;
  const searchAt = rest.indexOf('--search-gaps');
  const outAt = rest.indexOf('--out');
  const repoRootAt = rest.indexOf('--repo-root');
  const out = outAt >= 0 ? rest[outAt + 1] : null;
  const repoRoot = repoRootAt >= 0 ? rest[repoRootAt + 1] : null;
  const consumed = new Set([...(searchAt >= 0 ? [searchAt] : []), ...(outAt >= 0 ? [outAt, outAt + 1] : []), ...(repoRootAt >= 0 ? [repoRootAt, repoRootAt + 1] : [])]);
  if (!inputPath || (outAt >= 0 && !out) || (repoRootAt >= 0 && !repoRoot) || [...rest.keys()].some((index) => !consumed.has(index))) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 64;
    return;
  }
  let input;
  try {
    input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'declined', reasons: [`could not read JSON: ${error.message}`] })}\n`);
    process.exitCode = 2;
    return;
  }
  const result = advise(input, { repoRoot, searchGaps: searchAt >= 0 });
  if (result.status !== 'advised') {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  if (out) fs.writeFileSync(out, `${JSON.stringify(result.candidate, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: result.status, advice: result.advice, attempts: result.attempts, checks: result.quality.checks, candidateSha256: result.quality.candidateSha256 }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
