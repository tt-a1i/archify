#!/usr/bin/env node
// Experimental, offline-only repair for a single automatic Architecture route.
// It intentionally accepts only a full production showcase validation; callers
// must still run `finalize` for delivery/browser evidence.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const skill = path.join(root, 'archify');
const routeControlKeys = ['via', 'route', 'fromSide', 'toSide', 'channelX', 'channelY'];
const supportedCodes = new Set(['composition/short-interior-segment', 'composition/micro-segment']);
const minimumCorridorPx = 32;
const endpointStubPx = 24;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function detail(result) {
  return {
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
  };
}

function runProduction(candidate, { repoRoot } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-route-repair-'));
  const input = path.join(temp, 'candidate.architecture.json');
  const text = stableJson(candidate);
  const candidateSha256 = sha256(text);
  fs.writeFileSync(input, text);
  const repoArgs = repoRoot ? ['--repo-root', path.resolve(repoRoot)] : [];
  try {
    const layout = spawnSync(process.execPath, [path.join(skill, 'bin/archify.mjs'), 'validate', 'architecture', input, '--layout-json', ...repoArgs], {
      cwd: root, encoding: 'utf8', timeout: 15_000,
    });
    const validation = spawnSync(process.execPath, [path.join(skill, 'bin/archify.mjs'), 'validate', 'architecture', input, '--quality', 'showcase', '--json', ...repoArgs], {
      cwd: root, encoding: 'utf8', timeout: 15_000,
    });
    const layoutReceipt = parseJson(layout.stdout);
    const validationReceipt = parseJson(validation.stdout);
    const layoutOk = layout.status === 0 && layoutReceipt?.ok === true
      && Array.isArray(layoutReceipt.components) && Array.isArray(layoutReceipt.connections);
    const validationOk = validation.status === 0 && validationReceipt?.ok === true
      && validationReceipt.candidate?.sha256 === candidateSha256
      && validationReceipt.composition?.profile === 'showcase'
      && validationReceipt.composition?.summary?.errors === 0
      && validationReceipt.composition?.summary?.warnings === 0
      && Array.isArray(validationReceipt.checks) && validationReceipt.checks.length >= 9
      && validationReceipt.checks.every((check) => check?.ok === true);
    return {
      ok: layoutOk && validationOk,
      candidateSha256,
      layout: detail(layout), validation: detail(validation),
      layoutReceipt, validationReceipt,
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function semanticProjection(value) {
  const projected = clone(value);
  for (const connection of projected.connections ?? []) delete connection.via;
  return projected;
}

function routeControls(input) {
  const controls = [];
  for (const [index, connection] of (input.connections ?? []).entries()) {
    const keys = routeControlKeys.filter((key) => Object.hasOwn(connection, key));
    if (keys.length) controls.push({ index, id: connection.id ?? null, keys });
  }
  return controls;
}

function inputProblems(input) {
  const problems = [];
  if (input?.diagram_type !== 'architecture') problems.push('only architecture diagrams are supported by this offline prototype.');
  if (!Array.isArray(input?.components) || !Array.isArray(input?.connections)) problems.push('input needs architecture components and connections arrays.');
  const controls = routeControls(input);
  if (controls.length) problems.push(`declined authored route controls on ${controls.map((item) => `connections[${item.index}]${item.id ? ` id "${item.id}"` : ''} (${item.keys.join(', ')})`).join('; ')}.`);
  return problems;
}

function diagnosticCodes(receipt) {
  return [...new Set((receipt?.diagnostics ?? []).map((entry) => entry?.code).filter(Boolean))];
}

function relationshipIdentity(entry) {
  const relationship = entry?.subject?.relationship || entry?.relationship || entry?.evidence?.relationship;
  return {
    id: entry?.subject?.id ?? relationship?.id ?? entry?.evidence?.id ?? null,
    from: relationship?.from ?? entry?.subject?.from ?? entry?.evidence?.from ?? null,
    to: relationship?.to ?? entry?.subject?.to ?? entry?.evidence?.to ?? null,
  };
}

function selectConnection(input, diagnostics) {
  const supported = diagnostics.filter((entry) => supportedCodes.has(entry?.code));
  if (!supported.length) return { reason: 'no supported local route diagnostic was emitted.' };
  const targets = new Set();
  for (const entry of supported) {
    const identity = relationshipIdentity(entry);
    const matches = input.connections.map((connection, index) => ({ connection, index })).filter(({ connection }) => (
      (identity.id && connection.id === identity.id)
      || (!identity.id && identity.from && identity.to && connection.from === identity.from && connection.to === identity.to)
    ));
    if (matches.length !== 1) return { reason: 'the diagnostic did not identify one unambiguous connection.' };
    targets.add(matches[0].index);
  }
  if (targets.size !== 1) return { reason: 'the production diagnostics identify more than one route; this helper repairs one local edge only.' };
  return { index: [...targets][0] };
}

function direction(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) > 0.0001 && Math.abs(dy) > 0.0001) return null;
  if (dx > 0) return 'right';
  if (dx < 0) return 'left';
  if (dy > 0) return 'bottom';
  if (dy < 0) return 'top';
  return null;
}

function outward(point, side, distance = endpointStubPx) {
  const vectors = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
  const vector = vectors[side];
  return vector ? [point[0] + vector[0] * distance, point[1] + vector[1] * distance] : null;
}

function normalize(points) {
  const output = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return null;
    const previous = output.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) output.push(point);
  }
  return output;
}

function isOrthogonal(points) {
  return points.every((point, index) => index === 0 || point[0] === points[index - 1][0] || point[1] === points[index - 1][1]);
}

function connectionLayout(receipt, connection) {
  const matches = (receipt?.connections ?? []).filter((item) => (
    item.from === connection.from && item.to === connection.to && item.label === connection.label
  ));
  return matches.length === 1 ? matches[0] : null;
}

function expandInteriorSegments(points) {
  const adjusted = normalize(points.map((point) => [...point]));
  if (!adjusted || !isOrthogonal(adjusted)) return null;
  // An interior segment ends before the target stub and starts after the
  // source stub. Move only the next local bend (and its perpendicular mate),
  // never a component, label, or unrelated route.
  for (let index = 1; index < adjusted.length - 2; index += 1) {
    const start = adjusted[index];
    const end = adjusted[index + 1];
    const side = direction(start, end);
    const length = Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]);
    if (!side || length >= 16) continue;
    const delta = 16 - length;
    const horizontal = side === 'left' || side === 'right';
    const sign = side === 'left' || side === 'top' ? -1 : 1;
    if (index === adjusted.length - 3) {
      // Keep the target stub and move the preceding interior bend outward.
      if (horizontal) start[0] -= sign * delta;
      else start[1] -= sign * delta;
    } else {
      // Preserve the following perpendicular segment by moving its other end
      // by the same coordinate delta. The next horizontal/vertical run then
      // remains orthogonal without changing its far corridor coordinate.
      if (horizontal) {
        end[0] += sign * delta;
        adjusted[index + 2][0] += sign * delta;
      } else {
        end[1] += sign * delta;
        adjusted[index + 2][1] += sign * delta;
      }
    }
  }
  return normalize(adjusted);
}

function measuredDetourCandidate(basePoints, probePoints) {
  const base = normalize(basePoints);
  const probe = normalize(probePoints);
  if (!base || !probe || base.length < 4 || probe.length !== 2 || !isOrthogonal(base)) return null;
  const fromSide = direction(base[0], base[1]);
  const toSide = direction(base.at(-1), base.at(-2));
  const startStub = outward(probe[0], fromSide);
  const endStub = outward(probe[1], toSide);
  if (!fromSide || !toSide || !startStub || !endStub) return null;
  const rebased = base.map((point) => [...point]);
  rebased[0] = [...probe[0]];
  rebased[1] = startStub;
  rebased[rebased.length - 2] = endStub;
  rebased[rebased.length - 1] = [...probe[1]];
  const expanded = expandInteriorSegments(rebased);
  return expanded && isOrthogonal(expanded) ? expanded.slice(1, -1) : null;
}

// These four recipes are fixed before validation. They use only the diagnosed
// edge's measured endpoint normals and a small local corridor; no model calls
// or adaptive global search is involved.
function corridorCandidates(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const start = points[0];
  const end = points.at(-1);
  const fromSide = direction(start, points[1]);
  const toSide = direction(end, points.at(-2));
  const startStub = outward(start, fromSide);
  const endStub = outward(end, toSide);
  if (!fromSide || !toSide || !startStub || !endStub) return [];
  const horizontal = new Set(['left', 'right']);
  const vertical = new Set(['top', 'bottom']);
  const candidates = [];
  if (horizontal.has(fromSide) && horizontal.has(toSide)) {
    for (const channelY of [Math.max(startStub[1], endStub[1]) + minimumCorridorPx, Math.min(startStub[1], endStub[1]) - minimumCorridorPx]) {
      candidates.push({ recipe: channelY > Math.max(startStub[1], endStub[1]) ? 'horizontal-south-corridor' : 'horizontal-north-corridor', via: [startStub, [startStub[0], channelY], [endStub[0], channelY], endStub] });
    }
  } else if (vertical.has(fromSide) && vertical.has(toSide)) {
    for (const channelX of [Math.max(startStub[0], endStub[0]) + minimumCorridorPx, Math.min(startStub[0], endStub[0]) - minimumCorridorPx]) {
      candidates.push({ recipe: channelX > Math.max(startStub[0], endStub[0]) ? 'vertical-east-corridor' : 'vertical-west-corridor', via: [startStub, [channelX, startStub[1]], [channelX, endStub[1]], endStub] });
    }
  } else {
    candidates.push({ recipe: 'mixed-first-corner', via: [startStub, [endStub[0], startStub[1]], endStub] });
    candidates.push({ recipe: 'mixed-second-corner', via: [startStub, [startStub[0], endStub[1]], endStub] });
  }
  return candidates.map((candidate) => ({ ...candidate, via: normalize(candidate.via) }))
    .filter((candidate) => candidate.via && isOrthogonal([start, ...candidate.via, end]));
}

function changeReceipt({ inputSha256, selected, initial, attempts, endpointProbe, startedAt }) {
  return {
    contract: 'archify-offline-route-repair-v1',
    localTime: startedAt,
    trialCount: attempts.length,
    inputSha256,
    selectedConnection: selected,
    initialDiagnosticCodes: diagnosticCodes(initial.validationReceipt),
    endpointProbe,
    attempts,
    finalizeRequired: true,
  };
}

export function repair(input, { repoRoot } = {}) {
  const startedAt = new Date().toString();
  const inputText = stableJson(input);
  const inputSha256 = sha256(inputText);
  const problems = inputProblems(input);
  if (problems.length) return { status: 'declined', reasons: problems, receipt: changeReceipt({ inputSha256, selected: null, initial: {}, attempts: [], endpointProbe: null, startedAt }) };

  const initial = runProduction(input, { repoRoot });
  if (initial.ok) return {
    status: 'unchanged', candidate: clone(input), quality: initial,
    receipt: changeReceipt({ inputSha256, selected: null, initial, attempts: [], endpointProbe: null, startedAt }),
  };
  const initialDiagnostics = initial.validationReceipt?.diagnostics ?? [];
  const unsupported = diagnosticCodes(initial.validationReceipt).filter((code) => !supportedCodes.has(code));
  if (unsupported.length) return {
    status: 'declined', reasons: [`production validation includes non-route diagnostics: ${unsupported.join(', ')}.`], quality: initial,
    receipt: changeReceipt({ inputSha256, selected: null, initial, attempts: [], endpointProbe: null, startedAt }),
  };
  const selected = selectConnection(input, initialDiagnostics);
  if (!Number.isInteger(selected.index)) return {
    status: 'declined', reasons: [selected.reason], quality: initial,
    receipt: changeReceipt({ inputSha256, selected: null, initial, attempts: [], endpointProbe: null, startedAt }),
  };
  const selectedConnection = input.connections[selected.index];
  const layoutConnection = connectionLayout(initial.layoutReceipt, selectedConnection);
  if (!layoutConnection?.points) return {
    status: 'declined', reasons: ['production layout evidence did not expose the diagnosed route points.'], quality: initial,
    receipt: changeReceipt({ inputSha256, selected, initial, attempts: [], endpointProbe: null, startedAt }),
  };
  // `via: []` is a bounded measurement-only probe. It disables automatic port
  // spread for this one edge, allowing the production layout receipt to state
  // the actual anchors an authored route would receive. It is never returned.
  const probeCandidate = clone(input);
  probeCandidate.connections[selected.index].via = [];
  const endpointMeasurement = runProduction(probeCandidate, { repoRoot });
  const probeConnection = connectionLayout(endpointMeasurement.layoutReceipt, selectedConnection);
  const endpointProbe = {
    candidateSha256: endpointMeasurement.candidateSha256,
    diagnosticCodes: diagnosticCodes(endpointMeasurement.validationReceipt),
    points: probeConnection?.points ?? null,
  };
  const measuredVia = measuredDetourCandidate(layoutConnection.points, probeConnection?.points);
  const recipes = [
    ...(measuredVia ? [{ recipe: 'measured-local-detour', via: measuredVia }] : []),
    ...corridorCandidates(probeConnection?.points ?? layoutConnection.points),
  ];
  if (!recipes.length) return {
    status: 'declined', reasons: ['the diagnosed route has no supported local endpoint-side corridor recipe.'], quality: initial,
    receipt: changeReceipt({ inputSha256, selected, initial, attempts: [], endpointProbe, startedAt }),
  };

  const attempts = [];
  for (const { recipe, via } of recipes) {
    const candidate = clone(input);
    candidate.connections[selected.index].via = via;
    if (JSON.stringify(semanticProjection(input)) !== JSON.stringify(semanticProjection(candidate))) {
      return { status: 'declined', reasons: ['internal guard rejected a semantic mutation.'], quality: initial,
        receipt: changeReceipt({ inputSha256, selected, initial, attempts, endpointProbe, startedAt }) };
    }
    const quality = runProduction(candidate, { repoRoot });
    attempts.push({ recipe, via, candidateSha256: quality.candidateSha256, ok: quality.ok, diagnosticCodes: diagnosticCodes(quality.validationReceipt) });
    if (quality.ok) return {
      status: 'repaired', candidate, quality,
      receipt: changeReceipt({ inputSha256, selected: { index: selected.index, id: input.connections[selected.index].id ?? null }, initial, attempts, endpointProbe, startedAt }),
    };
  }
  return {
    status: 'declined', reasons: ['no predeclared local corridor candidate passed the production layout and showcase gates.'], quality: initial,
    receipt: changeReceipt({ inputSha256, selected: { index: selected.index, id: input.connections[selected.index].id ?? null }, initial, attempts, endpointProbe, startedAt }),
  };
}

function usage() {
  return 'Usage: node route-repair.mjs <input.architecture.json> [--repo-root <repository>] [--out <candidate.json>]';
}

function main(args) {
  const [inputPath, ...rest] = args;
  const outAt = rest.indexOf('--out');
  const repoRootAt = rest.indexOf('--repo-root');
  const out = outAt >= 0 ? rest[outAt + 1] : null;
  const repoRoot = repoRootAt >= 0 ? rest[repoRootAt + 1] : null;
  const consumed = new Set([...(outAt >= 0 ? [outAt, outAt + 1] : []), ...(repoRootAt >= 0 ? [repoRootAt, repoRootAt + 1] : [])]);
  if (!inputPath || (outAt >= 0 && !out) || (repoRootAt >= 0 && !repoRoot) || [...rest.keys()].some((index) => !consumed.has(index))) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 64;
    return;
  }
  let input;
  try { input = JSON.parse(fs.readFileSync(inputPath, 'utf8')); } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'declined', reasons: [`could not read JSON: ${error.message}`] })}\n`);
    process.exitCode = 2;
    return;
  }
  const result = repair(input, { repoRoot });
  if (result.status === 'repaired' && out) fs.writeFileSync(out, stableJson(result.candidate));
  process.stdout.write(`${JSON.stringify({ status: result.status, reasons: result.reasons, receipt: result.receipt, candidateSha256: result.quality?.candidateSha256 }, null, 2)}\n`);
  if (result.status === 'declined') process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
