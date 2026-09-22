#!/usr/bin/env node
// Offline, bounded geometry preflight for the repair-firstpass experiment.
// It deliberately delegates layout and quality decisions to the production CLI.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { minimumNodeTextWidth } from '../../archify/renderers/shared/text-fit.mjs';
import { textUnits } from '../../archify/renderers/shared/utils.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');
const archifyCli = path.join(projectRoot, 'archify/bin/archify.mjs');
const MAX_ATTEMPTS = 64;
const MAX_MS = 20_000;
const GEOMETRY_COMPONENT_KEYS = new Set(['pos', 'size', 'row', 'col']);
const GEOMETRY_META_KEYS = new Set(['viewBox']);
const PINNED_CONNECTION_KEYS = [
  'via', 'channelX', 'channelY', 'labelAt', 'labelDx', 'labelDy', 'labelSegment',
];

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => JSON.stringify(value);

// A semantic projection is intentionally strict: only the production geometry
// fields this experiment is allowed to alter are removed before hashing.
export function semanticProjection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const projected = clone(value);
  delete projected.layout;
  if (projected.meta && typeof projected.meta === 'object') {
    for (const key of GEOMETRY_META_KEYS) delete projected.meta[key];
  }
  for (const component of Array.isArray(projected.components) ? projected.components : []) {
    if (!component || typeof component !== 'object') continue;
    for (const key of GEOMETRY_COMPONENT_KEYS) delete component[key];
  }
  return projected;
}

export function semanticHash(value) {
  return sha256(canonical(semanticProjection(value)));
}

function inputProblems(input) {
  const problems = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['input must be a JSON object.'];
  if (input.schema_version !== 1) problems.push('schema_version must be 1.');
  if (input.diagram_type !== 'architecture') problems.push('diagram_type must be "architecture".');
  if (!input.meta || typeof input.meta !== 'object' || Array.isArray(input.meta)) problems.push('meta must be an object.');
  if (!Array.isArray(input.components) || input.components.length === 0) problems.push('components must be a non-empty array.');
  if (!Array.isArray(input.connections)) problems.push('connections must be an array.');
  const ids = new Set();
  for (const component of Array.isArray(input.components) ? input.components : []) {
    if (!component || typeof component !== 'object' || Array.isArray(component)) {
      problems.push('every component must be an object.');
      continue;
    }
    if (typeof component.id !== 'string' || !component.id) problems.push('every component needs a non-empty id.');
    else if (ids.has(component.id)) problems.push(`duplicate component id "${component.id}".`);
    else ids.add(component.id);
    if (component.pos !== undefined && (!Array.isArray(component.pos) || component.pos.length !== 2
      || !component.pos.every(Number.isFinite))) problems.push(`component "${component.id ?? '<unknown>'}" has invalid pos.`);
    if (component.size !== undefined && (!Array.isArray(component.size) || component.size.length !== 2
      || !component.size.every((n) => Number.isFinite(n) && n > 0))) problems.push(`component "${component.id ?? '<unknown>'}" has invalid size.`);
  }
  for (const connection of Array.isArray(input.connections) ? input.connections : []) {
    if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
      problems.push('every connection must be an object.');
      continue;
    }
    if (!ids.has(connection.from) || !ids.has(connection.to)) {
      problems.push(`connection "${connection.id ?? '<unknown>'}" has a missing endpoint.`);
    }
    const pinned = PINNED_CONNECTION_KEYS.filter((key) => connection[key] !== undefined);
    if (connection.route !== undefined && connection.route !== 'auto') pinned.push('route');
    if (connection.fromSide !== undefined && connection.fromSide !== 'auto') pinned.push('fromSide');
    if (connection.toSide !== undefined && connection.toSide !== 'auto') pinned.push('toSide');
    if (pinned.length) problems.push(`connection "${connection.id ?? '<unknown>'}" has pinned geometry (${pinned.join(', ')}).`);
  }
  return problems;
}

function requiredSize(component) {
  const [originalW = 120, originalH = 60] = Array.isArray(component.size) ? component.size : [];
  const label = Math.ceil(Math.max(0, textUnits(component.label ?? '')) * 6.6);
  const sublabel = component.sublabel === undefined || component.sublabel === '' ? 0
    : Math.ceil(minimumNodeTextWidth(component.sublabel, 6) + 8);
  const tag = component.tag === undefined || component.tag === '' ? 0
    : Math.ceil(minimumNodeTextWidth(component.tag, 6) + 8);
  return [Math.max(originalW, 120, label, sublabel, tag), Math.max(originalH, component.sublabel || component.tag ? 64 : 60)];
}

function positions(input) {
  return input.components.map((component, index) => ({
    index,
    component,
    pos: Array.isArray(component.pos) ? component.pos : null,
  })).filter((entry) => entry.pos);
}

function setComponentPos(candidate, index, position) {
  candidate.components[index].pos = position.map((n) => Math.round(n));
}

function growText(input) {
  const candidate = clone(input);
  for (const component of candidate.components) component.size = requiredSize(component);
  return candidate;
}

function spreadFree(input, axis, extra) {
  const candidate = growText(input);
  const entries = positions(candidate).sort((left, right) => left.pos[axis] - right.pos[axis] || left.index - right.index);
  if (entries.length < 2) return candidate;
  const baseline = entries[0].pos[axis];
  for (const entry of entries) {
    const point = [...entry.pos];
    point[axis] = baseline + (point[axis] - baseline) * (1 + extra);
    setComponentPos(candidate, entry.index, point);
  }
  return candidate;
}

function snapFree(input, quantum = 8) {
  const candidate = growText(input);
  for (const entry of positions(candidate)) {
    setComponentPos(candidate, entry.index, entry.pos.map((n) => Math.round(n / quantum) * quantum));
  }
  return candidate;
}

function translateOne(input, index, dx, dy) {
  const candidate = growText(input);
  const position = candidate.components[index]?.pos;
  if (!Array.isArray(position)) return candidate;
  setComponentPos(candidate, index, [position[0] + dx, position[1] + dy]);
  return candidate;
}

function translateCandidate(input, index, dx, dy) {
  const candidate = clone(input);
  const position = candidate.components[index]?.pos;
  if (!Array.isArray(position)) return candidate;
  setComponentPos(candidate, index, [position[0] + dx, position[1] + dy]);
  return candidate;
}

function translateAll(input, dx, dy) {
  const candidate = growText(input);
  for (const entry of positions(candidate)) setComponentPos(candidate, entry.index, [entry.pos[0] + dx, entry.pos[1] + dy]);
  return candidate;
}

function growGrid(input, gapX, gapY) {
  if (!input.layout || input.layout.mode !== 'grid') return null;
  const candidate = growText(input);
  const layout = candidate.layout;
  const widths = candidate.components.map((component) => requiredSize(component)[0]);
  const heights = candidate.components.map((component) => requiredSize(component)[1]);
  layout.cellW = Math.max(layout.cellW ?? 120, ...widths);
  layout.cellH = Math.max(layout.cellH ?? 60, ...heights);
  layout.gapX = Math.max(layout.gapX ?? 30, gapX);
  layout.gapY = Math.max(layout.gapY ?? 40, gapY);
  return candidate;
}

function proposalSeeds(input, layoutReceipt) {
  const seeds = [{ id: 'grow-text', make: () => growText(input) }];
  if (input.layout?.mode === 'grid') {
    for (const [x, y] of [[48, 72], [64, 72], [48, 88], [64, 88], [80, 72], [48, 104], [80, 104]]) {
      seeds.push({ id: `grid-${x}x${y}`, make: () => growGrid(input, x, y) });
    }
  } else if (positions(input).length) {
    seeds.push(
      { id: 'snap-8-grow', make: () => snapFree(input) },
      { id: 'spread-x-10', make: () => spreadFree(input, 0, 0.10) },
      { id: 'spread-y-10', make: () => spreadFree(input, 1, 0.10) },
      { id: 'spread-xy-10', make: () => spreadFree(spreadFree(input, 0, 0.10), 1, 0.10) },
    );
  }
  for (const diagnostic of layoutReceipt?.diagnostics ?? []) {
    if (diagnostic.code === 'layout/boundary-out-of-bounds') {
      const overflow = diagnostic.evidence?.overflow ?? {};
      const x = overflow.left ? Math.ceil(overflow.left) + 8 : 0;
      const y = overflow.top ? Math.ceil(overflow.top) + 8 : 0;
      if (x || y) seeds.push({ id: `boundary-origin-${x}-${y}`, make: () => translateAll(input, x, y) });
    }
    if (diagnostic.code === 'clean-flow/edge-through-node') {
      const id = diagnostic.evidence?.obstacle?.id ?? diagnostic.subject?.obstacle?.id;
      const index = input.components.findIndex((component) => component.id === id);
      if (index >= 0) {
        seeds.push({ id: `obstacle-${index}-right`, make: () => translateOne(input, index, 24, 0) });
        seeds.push({ id: `obstacle-${index}-down`, make: () => translateOne(input, index, 0, 24) });
      }
    }
  }
  // Generic constraint/crossing and label diagnostics frequently improve when
  // one early free-layout box gets a dedicated corridor. The source order makes
  // this deterministic and caps this family well below the protocol maximum.
  const generic = (layoutReceipt?.diagnostics ?? []).some((item) => (
    item.code === 'layout/constraint' || item.code.includes('crossing')
      || item.code.includes('segment') || item.code.includes('label-route')
  ));
  if (generic && !input.layout) {
    for (const entry of positions(input).slice(0, 8)) {
      seeds.push({ id: `local-${entry.index}-right`, make: () => translateOne(input, entry.index, 32, 0) });
      seeds.push({ id: `local-${entry.index}-down`, make: () => translateOne(input, entry.index, 0, 32) });
    }
  }
  return seeds;
}

function diagnosticScore(receipt) {
  const diagnostics = Array.isArray(receipt?.diagnostics) ? receipt.diagnostics : [];
  const count = (code) => diagnostics.filter((item) => item?.code === code).length;
  // Compare the complete diagnostic-instance multiset before its category
  // counts. This keeps the beam from treating two remaining short stubs as
  // equivalent to one and makes progress reproducible across candidates.
  return [
    diagnostics.length,
    count('layout/constraint'),
    count('composition/label-route-clearance'),
    count('clean-flow/edge-through-node'),
    count('composition/proper-crossing'),
    count('composition/short-interior-segment'),
    count('composition/micro-segment'),
    ...diagnostics.map((item) => `${item.code}:${JSON.stringify(item.subject ?? {})}`).sort(),
  ];
}

function lessScore(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? '';
    const b = right[index] ?? '';
    if (a === b) continue;
    return a < b;
  }
  return false;
}

function targetIds(diagnostic) {
  const ids = [
    diagnostic?.subject?.from,
    diagnostic?.subject?.to,
    diagnostic?.evidence?.obstacle?.id,
    diagnostic?.subject?.obstacle?.id,
    diagnostic?.evidence?.otherRelationship?.from,
    diagnostic?.evidence?.otherRelationship?.to,
  ].filter((id) => typeof id === 'string');
  return [...new Set(ids)];
}

function targetAxes(diagnostic) {
  const start = diagnostic?.evidence?.from;
  const end = diagnostic?.evidence?.to;
  if (Array.isArray(start) && Array.isArray(end)) {
    if (start[0] === end[0]) return [[1, 0], [-1, 0]];
    if (start[1] === end[1]) return [[0, 1], [0, -1]];
  }
  return [[1, 0], [0, 1]];
}

function targetedSeeds(candidate, receipt, parentId) {
  const seeds = [];
  for (const [diagnosticIndex, diagnostic] of (receipt?.diagnostics ?? []).entries()) {
    const ids = targetIds(diagnostic);
    if (!ids.length) continue;
    for (const id of ids) {
      const componentIndex = candidate.components.findIndex((component) => component.id === id);
      if (componentIndex < 0 || !Array.isArray(candidate.components[componentIndex].pos)) continue;
      for (const [dx, dy] of targetAxes(diagnostic)) {
        for (const amount of [16, 32]) {
          seeds.push({
            id: `${parentId}>${diagnostic.code}:${diagnosticIndex}:${componentIndex}:${dx * amount},${dy * amount}`,
            make: () => translateCandidate(candidate, componentIndex, dx * amount, dy * amount),
          });
        }
      }
    }
  }
  // The fixed cap ensures one good intermediate state cannot consume the
  // protocol's 64 attempts before another independent diagnostic is tried.
  return seeds.slice(0, 16);
}

function readableTextSeed(candidate, receipt, parentId) {
  const readability = (receipt?.diagnostics ?? []).filter((diagnostic) => (
    diagnostic?.code === 'composition/desktop-readability'
  ));
  if (!readability.length) return [];
  const requiredFont = Math.max(...readability.map((diagnostic) => {
    const evidence = diagnostic.evidence ?? {};
    const scale = Number(evidence.scale);
    const minimum = Number(evidence.minimumProjectedFontPx);
    return Number.isFinite(scale) && scale > 0 && Number.isFinite(minimum)
      ? minimum / scale + 0.05 : 6;
  }));
  return [{
    id: `${parentId}>readable-secondary-${Math.ceil(requiredFont * 10) / 10}`,
    make: () => {
      const widened = clone(candidate);
      for (const component of widened.components) {
        const [width = 120, height = 60] = Array.isArray(component.size) ? component.size : [];
        const secondaryWidths = [component.sublabel, component.tag]
          .filter((text) => typeof text === 'string' && text.length > 0)
          .map((text) => Math.ceil(textUnits(text) * 0.6 * requiredFont + 9));
        if (secondaryWidths.length) component.size = [Math.max(width, ...secondaryWidths), height];
      }
      return widened;
    },
  }];
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function diagnosticInstances(receipt) {
  return (receipt?.diagnostics ?? []).map((item) => ({
    code: item?.code,
    ...(item?.subject === undefined ? {} : { subject: item.subject }),
    ...(item?.evidence === undefined ? {} : { evidence: item.evidence }),
  }));
}

function diagnosticSummary(receipt) {
  const instances = diagnosticInstances(receipt);
  return {
    count: instances.length,
    codes: [...new Set(instances.map((item) => item.code).filter(Boolean))],
    instances,
  };
}

function hasOnlyGeometricDiagnostics(receipt) {
  const diagnostics = receipt?.diagnostics;
  if (!Array.isArray(diagnostics)) return false;
  return diagnostics.every((item) => (
    item?.code === 'layout/constraint'
      || item?.code?.startsWith('layout/')
      || item?.code?.startsWith('composition/')
      || item?.code?.startsWith('clean-flow/')
  ));
}

function geometryProposal(candidate) {
  return {
    ...(candidate.layout === undefined ? {} : { layout: candidate.layout }),
    ...(candidate.meta?.viewBox === undefined ? {} : { viewBox: candidate.meta.viewBox }),
    components: candidate.components.map((component) => ({
      id: component.id,
      ...(component.pos === undefined ? {} : { pos: component.pos }),
      ...(component.size === undefined ? {} : { size: component.size }),
      ...(component.row === undefined ? {} : { row: component.row }),
      ...(component.col === undefined ? {} : { col: component.col }),
    })),
  };
}

function writeCandidate(temp, candidate) {
  const file = path.join(temp, 'candidate.architecture.json');
  const bytes = `${JSON.stringify(candidate, null, 2)}\n`;
  fs.writeFileSync(file, bytes);
  return { file, sha256: sha256(bytes) };
}

function runCli(args, remainingMs) {
  const result = spawnSync(process.execPath, [archifyCli, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: Math.max(1, Math.min(5_000, remainingMs)),
  });
  const receipt = parseJson(result.stdout);
  return {
    exitCode: result.status ?? (result.error?.code === 'ETIMEDOUT' ? 124 : 1),
    timedOut: result.error?.code === 'ETIMEDOUT',
    receipt,
    diagnostics: diagnosticSummary(receipt),
    stderr: result.stderr?.trim() || undefined,
  };
}

function staticPass(receipt, candidateSha) {
  return receipt?.ok === true && receipt?.command === 'validate'
    && receipt?.candidate?.sha256 === candidateSha
    && receipt?.composition?.profile === 'showcase'
    && receipt?.composition?.summary?.errors === 0
    && receipt?.composition?.summary?.warnings === 0
    && Array.isArray(receipt?.checks) && receipt.checks.length >= 9
    && receipt.checks.every((check) => check?.ok === true);
}

function qualityArgs(file, repoRoot, layout) {
  return ['validate', 'architecture', file, ...(layout ? ['--layout-json'] : ['--json']), '--quality', 'showcase', '--repo-root', repoRoot];
}

function makeAttempt({ id, candidate, repoRoot, started, temp }) {
  const prepared = writeCandidate(temp, candidate);
  const elapsed = () => Date.now() - started;
  const layout = runCli(qualityArgs(prepared.file, repoRoot, true), Math.max(1, MAX_MS - elapsed()));
  const attempt = {
    proposal: id,
    geometry: geometryProposal(candidate),
    elapsedMs: elapsed(),
    candidateSha256: prepared.sha256,
    layout: { exitCode: layout.exitCode, timedOut: layout.timedOut, diagnostics: layout.diagnostics },
  };
  if (layout.exitCode !== 0 || layout.receipt?.ok !== true) return {
    attempt, accepted: false, layoutReceipt: layout.receipt, assessmentReceipt: layout.receipt,
  };
  const validation = runCli(qualityArgs(prepared.file, repoRoot, false), Math.max(1, MAX_MS - elapsed()));
  attempt.validation = { exitCode: validation.exitCode, timedOut: validation.timedOut, diagnostics: validation.diagnostics };
  attempt.elapsedMs = elapsed();
  attempt.withinTimeBudget = attempt.elapsedMs <= MAX_MS;
  return {
    attempt,
    accepted: attempt.withinTimeBudget && validation.exitCode === 0 && staticPass(validation.receipt, prepared.sha256),
    layoutReceipt: layout.receipt,
    assessmentReceipt: validation.exitCode === 0 ? layout.receipt : validation.receipt,
  };
}

export function preflight(input, { repoRoot = projectRoot, started = Date.now(), inputSha256 } = {}) {
  const problems = inputProblems(input);
  if (problems.length) return {
    status: 'declined', reason: 'unsupported-input', reasons: problems,
    ...(inputSha256 ? { inputSha256 } : {}), attempts: [], elapsedMs: Date.now() - started,
  };
  const sourceSemanticHash = semanticHash(input);
  const attempts = [];
  const seen = new Set([sha256(canonical(input))]);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-repair-preflight-'));
  try {
    const baseline = makeAttempt({ id: 'baseline', candidate: input, repoRoot: path.resolve(repoRoot), started, temp });
    attempts.push(baseline.attempt);
    if (baseline.accepted && Date.now() - started <= MAX_MS) return {
      status: 'unchanged', sourceSemanticHash, ...(inputSha256 ? { inputSha256 } : {}), candidate: input, attempts, elapsedMs: Date.now() - started,
    };
    if (!hasOnlyGeometricDiagnostics(baseline.assessmentReceipt)) return {
      status: 'declined', reason: 'non-geometric-baseline-failure', sourceSemanticHash,
      ...(inputSha256 ? { inputSha256 } : {}), attempts, elapsedMs: Date.now() - started,
    };
    // The first attempt's renderer receipt is the only diagnostic source for
    // proposal ordering. It is already recorded in attempts; do not spend a
    // hidden extra validation pass just to regenerate it. Later proposals are
    // built from a strictly better candidate state, never from a patch merge.
    const queue = [];
    let sequence = 0;
    const enqueue = (seed, parentScore) => {
      let candidate;
      try { candidate = seed.make(); } catch { return; }
      if (!candidate || semanticHash(candidate) !== sourceSemanticHash) return;
      const digest = sha256(canonical(candidate));
      if (seen.has(digest)) return;
      seen.add(digest);
      queue.push({ id: seed.id, candidate, parentScore, sequence: sequence += 1 });
    };
    const baselineScore = diagnosticScore(baseline.assessmentReceipt);
    let bestScore = baselineScore;
    for (const seed of proposalSeeds(input, baseline.layoutReceipt)) enqueue(seed, baselineScore);
    for (const seed of readableTextSeed(input, baseline.assessmentReceipt, 'baseline')) enqueue(seed, baselineScore);
    while (queue.length) {
      if (attempts.length >= MAX_ATTEMPTS || Date.now() - started >= MAX_MS) break;
      queue.sort((left, right) => {
        if (lessScore(left.parentScore, right.parentScore)) return -1;
        if (lessScore(right.parentScore, left.parentScore)) return 1;
        return left.sequence - right.sequence;
      });
      const next = queue.shift();
      const result = makeAttempt({ id: next.id, candidate: next.candidate, repoRoot: path.resolve(repoRoot), started, temp });
      attempts.push(result.attempt);
      if (result.accepted && Date.now() - started <= MAX_MS) return {
        status: 'accepted', sourceSemanticHash, ...(inputSha256 ? { inputSha256 } : {}), candidateSemanticHash: semanticHash(next.candidate), candidate: next.candidate,
        attempts, elapsedMs: Date.now() - started,
      };
      const score = diagnosticScore(result.assessmentReceipt);
      if (hasOnlyGeometricDiagnostics(result.assessmentReceipt) && lessScore(score, bestScore)) {
        bestScore = score;
        for (const seed of targetedSeeds(next.candidate, result.assessmentReceipt, next.id)) enqueue(seed, score);
        for (const seed of readableTextSeed(next.candidate, result.assessmentReceipt, next.id)) enqueue(seed, score);
      }
    }
    return {
      status: 'declined', reason: Date.now() - started >= MAX_MS ? 'time-budget-exhausted' : 'no-passing-geometry-proposal',
      sourceSemanticHash, ...(inputSha256 ? { inputSha256 } : {}), attempts, elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      status: 'declined', reason: 'preflight-error', reasons: [error.message], sourceSemanticHash, ...(inputSha256 ? { inputSha256 } : {}),
      attempts, elapsedMs: Date.now() - started,
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function usage() {
  return 'Usage: node preflight.mjs <input.json> --out <candidate.json> --repo-root <root> --allow-reflow --json';
}

function canonicalOutputPath(target) {
  const absolute = path.resolve(target);
  if (fs.existsSync(absolute)) return fs.realpathSync(absolute);
  return path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
}

function main(args) {
  const [inputPath, ...rest] = args;
  const outAt = rest.indexOf('--out');
  const repoAt = rest.indexOf('--repo-root');
  const allowed = new Set(['--out', '--repo-root', '--allow-reflow', '--json']);
  const unknown = rest.find((arg, index) => arg.startsWith('--') && !allowed.has(arg)
    && !(index > 0 && (rest[index - 1] === '--out' || rest[index - 1] === '--repo-root')));
  if (!inputPath || rest.length !== 6 || outAt < 0 || repoAt < 0 || !rest.includes('--allow-reflow') || !rest.includes('--json')
    || !rest[outAt + 1] || !rest[repoAt + 1] || unknown) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  let sourceBytes;
  let input;
  try {
    sourceBytes = fs.readFileSync(inputPath);
    input = JSON.parse(sourceBytes);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'declined', reason: 'invalid-json', reasons: [error.message], attempts: [] })}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    const inputStat = fs.statSync(inputPath);
    const outputPath = rest[outAt + 1];
    const sameFile = fs.existsSync(outputPath) && (() => {
      const outputStat = fs.statSync(outputPath);
      return inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino;
    })();
    if (sameFile || canonicalOutputPath(inputPath) === canonicalOutputPath(outputPath)) {
      process.stdout.write(`${JSON.stringify({ status: 'declined', reason: 'unsafe-output-path', reasons: ['--out must name a distinct file from the input.'], attempts: [] })}\n`);
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'declined', reason: 'unsafe-output-path', reasons: [error.message], attempts: [] })}\n`);
    process.exitCode = 1;
    return;
  }
  const report = preflight(input, { repoRoot: rest[repoAt + 1], inputSha256: sha256(sourceBytes) });
  // The source is never written. A distinct output appears only after the
  // full static showcase gate; an unchanged valid source is safe to copy.
  if (report.status === 'accepted' || report.status === 'unchanged') {
    fs.writeFileSync(rest[outAt + 1], report.status === 'unchanged' ? sourceBytes : `${JSON.stringify(report.candidate, null, 2)}\n`);
    report.output = path.resolve(rest[outAt + 1]);
    delete report.candidate;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === 'declined' ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
