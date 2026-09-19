#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const benchmarkRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(benchmarkRoot, '..', '..');
const defaultManifest = path.join(benchmarkRoot, 'manifest.json');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument ${JSON.stringify(token)}.`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value.`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function loadSource(entry) {
  if (entry.path) {
    const file = path.resolve(repositoryRoot, entry.path);
    return { document: readJson(file), sourcePath: file, sourceBytes: fs.readFileSync(file) };
  }
  if (entry.loader === 'large-adaptive-workflow') {
    const file = path.resolve(repositoryRoot, entry.source);
    const module = await import(`${pathToFileURL(file).href}?benchmark=adaptive-workflow-pilot`);
    const document = module.largeAdaptiveWorkflow();
    return { document, sourcePath: file, sourceBytes: Buffer.from(`${stableJson(document)}\n`) };
  }
  throw new Error(`Source ${entry.id} has no supported path or loader.`);
}

function gitSnapshot(root, declaredRevision) {
  const gitRoot = path.resolve(root, '..');
  const revision = spawnSync('git', ['-C', gitRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const status = spawnSync('git', ['-C', gitRoot, 'status', '--porcelain'], { encoding: 'utf8' });
  const detectedRevision = revision.status === 0 ? revision.stdout.trim() : null;
  const files = [
    'renderers/workflow/workflow-compiler.mjs',
    'renderers/workflow/render-workflow.mjs',
    'bin/archify.mjs',
    'scripts/check-render-output.mjs',
    'package.json',
  ];
  const content = files.map((relative) => {
    const file = path.join(root, relative);
    return `${relative}\0${fs.existsSync(file) ? sha256(fs.readFileSync(file)) : 'missing'}`;
  }).join('\n');
  return {
    declaredRevision,
    detectedRevision,
    revisionMatches: !detectedRevision || detectedRevision === declaredRevision,
    dirty: status.status === 0 ? status.stdout.trim() !== '' : null,
    codeHash: sha256(content),
    files,
  };
}

export function diagnosticFamily(code = '') {
  if (/viewport-overflow|viewport-containment/.test(code)) return 'viewport-containment';
  if (/viewbox-capacity/.test(code)) return 'viewbox-capacity';
  if (/node-overlap|node-clearance|node-collision/.test(code)) return 'node-overlap';
  if (/crossing|corridor|stacked-edge/.test(code)) return 'edge-crossing';
  if (/label|legend-clearance/.test(code)) return 'label-clearance';
  if (/readability|micro-text|text-fit/.test(code)) return 'readability';
  if (/language|locale|cjk/.test(code)) return 'language';
  if (/schema|semantic|topology|reachability|evidence/.test(code)) return 'semantic';
  if (/input|runtime|chrome|provider|timeout|internal|cli/.test(code)) return 'infrastructure';
  return 'other';
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value) {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

async function configuration({ id, skillRoot, revision }) {
  const root = path.resolve(skillRoot);
  const compilerPath = path.join(root, 'renderers', 'workflow', 'workflow-compiler.mjs');
  if (!fs.existsSync(compilerPath)) throw new Error(`Workflow compiler not found at ${compilerPath}.`);
  const compiler = await import(`${pathToFileURL(compilerPath).href}?benchmark=${encodeURIComponent(id)}-${Date.now()}`);
  return { id, skillRoot: root, revision, snapshot: gitSnapshot(root, revision), compileWorkflow: compiler.compileWorkflow };
}

function parseCliReceipt(result) {
  try { return JSON.parse(result.stdout); } catch {
    return {
      ok: false,
      diagnostics: [{ code: 'infrastructure/invalid-cli-receipt', message: result.stderr || result.stdout }],
    };
  }
}

async function attempt({ config, source, sourceEntry, pair, order, sequence }) {
  const candidateText = `${JSON.stringify(source.document, null, 2)}\n`;
  const beforeHash = sha256(candidateText);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-adaptive-benchmark-'));
  const candidate = path.join(scratch, `${sourceEntry.id}.workflow.json`);
  fs.writeFileSync(candidate, candidateText);
  const started = performance.now();
  let compiled;
  let compileError = null;
  const compileStarted = performance.now();
  try {
    compiled = config.compileWorkflow({ workflow: JSON.parse(candidateText), qualityProfile: 'showcase' });
  } catch (error) {
    compileError = error;
  }
  const compileMs = performance.now() - compileStarted;
  const validateStarted = performance.now();
  const cliResult = spawnSync(process.execPath, [
    path.join(config.skillRoot, 'bin', 'archify.mjs'),
    'validate', 'workflow', candidate, '--quality', 'showcase', '--json',
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const validationMs = performance.now() - validateStarted;
  const cli = parseCliReceipt(cliResult);
  const afterBytes = fs.existsSync(candidate) ? fs.readFileSync(candidate) : null;
  const afterHash = afterBytes ? sha256(afterBytes) : null;
  const diagnosticCodes = [
    ...(compiled?.diagnostics || []).map(({ code }) => code),
    ...(cli?.diagnostics || []).map(({ code }) => code),
    ...(cli?.composition?.diagnostics || []).map(({ code }) => code),
    ...(compileError ? ['infrastructure/compiler-exception'] : []),
  ].filter(Boolean);
  const finished = performance.now();
  const receipt = {
    schemaVersion: 1,
    evidenceClass: 'machine-only',
    sourceId: sourceEntry.id,
    source: {
      path: path.relative(repositoryRoot, source.sourcePath),
      sha256: sha256(source.sourceBytes),
      materializedInputSha256: beforeHash,
      frameMode: sourceEntry.frameMode,
      nodes: source.document.nodes.length,
      edges: source.document.edges.length,
      views: source.document.meta?.views?.length || 0,
    },
    configuration: {
      id: config.id,
      revision: config.revision,
      codeHash: config.snapshot.codeHash,
    },
    pair,
    order,
    sequence,
    qualityProfile: 'showcase',
    inputHash: beforeHash,
    candidateHashBefore: beforeHash,
    candidateHashAfter: afterHash,
    mutationOutcome: afterHash === beforeHash ? 'unchanged' : afterHash ? 'changed' : 'missing',
    durationMs: {
      compile: round(compileMs),
      validationRepair: round(validationMs),
      artifactReady: round(compileMs),
      reviewReady: round(finished - started),
      handoffReady: round(finished - started),
      barrierWait: 0,
      reporting: 0,
    },
    validation: {
      ok: compiled?.ok === true && cliResult.status === 0 && cli?.ok === true,
      compileOk: compiled?.ok === true,
      cliOk: cliResult.status === 0 && cli?.ok === true,
      validateAttempts: 1,
      failedAttempts: compiled?.ok === true && cliResult.status === 0 && cli?.ok === true ? 0 : 1,
      candidateMutations: afterHash === beforeHash ? 0 : 1,
      diagnosticCodes,
      diagnosticFamilies: [...new Set(diagnosticCodes.map(diagnosticFamily))].sort(),
      boundedStop: compiled?.receipt?.operationBudget?.status === 'exhausted',
    },
    hashes: {
      layoutReceipt: compiled?.receipt ? sha256(stableJson(compiled.receipt)) : null,
      artifact: compiled?.svg ? sha256(compiled.svg) : null,
      qualityReceipt: cli ? sha256(stableJson(cli)) : null,
    },
    layout: compiled?.receipt ? {
      contract: compiled.receipt.contract,
      digest: compiled.receipt.layoutDigest || null,
      viewBox: compiled.receipt.viewBox,
      requiredViewBox: compiled.receipt.requiredViewBox,
      operationBudget: compiled.receipt.operationBudget || null,
    } : null,
    error: compileError?.message || null,
  };
  fs.rmSync(scratch, { recursive: true, force: true });
  return receipt;
}

export function summarize(receipts, configurations) {
  const bySourcePair = new Map();
  for (const receipt of receipts) {
    const key = `${receipt.sourceId}\0${receipt.pair}`;
    if (!bySourcePair.has(key)) bySourcePair.set(key, {});
    bySourcePair.get(key)[receipt.configuration.id] = receipt;
  }
  const ids = configurations.map(({ id }) => id);
  const paired = [...bySourcePair.values()].filter((pair) => ids.every((id) => pair[id]));
  const metric = (name) => paired.map((pair) => {
    const left = pair[ids[0]].durationMs[name];
    const right = pair[ids[1]].durationMs[name];
    return { baselineMs: left, candidateMs: right, deltaRatio: left ? (right - left) / left : null };
  });
  const validation = metric('validationRepair');
  const handoff = metric('handoffReady');
  const baselineHandoff = handoff.map(({ baselineMs }) => baselineMs);
  const candidateHandoff = handoff.map(({ candidateMs }) => candidateMs);
  const baselineHandoffP95 = percentile(baselineHandoff, 0.95);
  const candidateHandoffP95 = percentile(candidateHandoff, 0.95);
  const viewportFamilies = new Set(['viewport-containment', 'viewbox-capacity']);
  const repairs = (id) => receipts.filter((receipt) => receipt.configuration.id === id)
    .reduce((count, receipt) => count + receipt.validation.diagnosticFamilies.filter((family) => viewportFamilies.has(family)).length, 0);
  const baselineRepairs = repairs(ids[0]);
  const candidateRepairs = repairs(ids[1]);
  return {
    pairCount: paired.length,
    validationRepair: {
      pairedMedianDeltaRatio: round(median(validation.map(({ deltaRatio }) => deltaRatio).filter((value) => value != null))),
      baselineMedianMs: round(median(validation.map(({ baselineMs }) => baselineMs))),
      candidateMedianMs: round(median(validation.map(({ candidateMs }) => candidateMs))),
    },
    handoffReady: {
      pairedMedianDeltaRatio: round(median(handoff.map(({ deltaRatio }) => deltaRatio).filter((value) => value != null))),
      baselineMedianMs: round(median(baselineHandoff)),
      candidateMedianMs: round(median(candidateHandoff)),
      baselineP95Ms: round(baselineHandoffP95),
      candidateP95Ms: round(candidateHandoffP95),
      p95DeltaRatio: baselineHandoffP95
        ? round((candidateHandoffP95 - baselineHandoffP95) / baselineHandoffP95)
        : null,
    },
    viewportRepair: {
      baselineCount: baselineRepairs,
      candidateCount: candidateRepairs,
      reductionRatio: baselineRepairs ? round((baselineRepairs - candidateRepairs) / baselineRepairs) : null,
    },
    firstCandidatePassRate: Object.fromEntries(ids.map((id) => {
      const values = receipts.filter((receipt) => receipt.configuration.id === id);
      return [id, values.length ? values.filter((receipt) => receipt.validation.ok).length / values.length : null];
    })),
    boundedStops: Object.fromEntries(ids.map((id) => [id, receipts.filter((receipt) => (
      receipt.configuration.id === id && receipt.validation.boundedStop
    )).length])),
  };
}

async function executeMatched({ manifestPath, aRoot, bRoot, aRevision, bRevision, pairs, output }) {
  const manifest = readJson(manifestPath);
  const configurations = [
    await configuration({ id: 'A', skillRoot: aRoot, revision: aRevision }),
    await configuration({ id: 'B', skillRoot: bRoot, revision: bRevision }),
  ];
  const pairCount = Number(pairs || manifest.pairCount);
  if (!Number.isInteger(pairCount) || pairCount < 1) throw new Error('--pairs must be a positive integer.');
  const sources = await Promise.all(manifest.sources.map(loadSource));
  for (let index = 0; index < sources.length; index += 1) {
    const expected = manifest.sources[index];
    const source = sources[index].document;
    if (source.schema_version !== 2 || source.diagram_type !== 'workflow') throw new Error(`${expected.id} is not Workflow v2.`);
    if (expected.minimumNodes && source.nodes.length < expected.minimumNodes) throw new Error(`${expected.id} has too few nodes.`);
    if (expected.minimumEdges && source.edges.length < expected.minimumEdges) throw new Error(`${expected.id} has too few edges.`);
  }
  const receipts = [];
  let sequence = 0;
  for (let pair = 1; pair <= pairCount; pair += 1) {
    const order = pair % 2 ? configurations : [...configurations].reverse();
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      for (const config of order) {
        receipts.push(await attempt({
          config,
          source: sources[sourceIndex],
          sourceEntry: manifest.sources[sourceIndex],
          pair,
          order: order.map(({ id }) => id).join(''),
          sequence: ++sequence,
        }));
      }
    }
  }
  const result = {
    schemaVersion: 1,
    benchmark: manifest.benchmark,
    evidenceClass: 'machine-only',
    evidenceEligibleForEndToEndClaim: false,
    limitation: 'This harness freezes and measures the deterministic machine pipeline. It does not observe model authoring, repair behavior, human review, or concurrent-agent wall time.',
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
      manifestSha256: sha256(fs.readFileSync(manifestPath)),
    },
    configurations: configurations.map(({ id, revision, skillRoot, snapshot }) => ({ id, revision, skillRoot, snapshot })),
    schedule: { pairCount, order: 'AB/BA alternating', sourceCount: sources.length },
    receipts,
  };
  result.summary = summarize(receipts, result.configurations);
  result.resultSha256 = sha256(stableJson({ ...result, resultSha256: undefined }));
  writeJson(output, result);
  return result;
}

async function checkManifest(manifestPath) {
  const manifest = readJson(manifestPath);
  if (manifest.evidenceClass !== 'machine-only') throw new Error('Manifest must remain machine-only.');
  if (!Array.isArray(manifest.sources) || manifest.sources.length < 6) throw new Error('Manifest requires at least six Workflow sources.');
  const sources = await Promise.all(manifest.sources.map(loadSource));
  return {
    ok: true,
    sourceCount: sources.length,
    sources: sources.map((source, index) => ({
      id: manifest.sources[index].id,
      sha256: sha256(source.sourceBytes),
      materializedInputSha256: sha256(`${JSON.stringify(source.document, null, 2)}\n`),
      nodes: source.document.nodes.length,
      edges: source.document.edges.length,
      views: source.document.meta?.views?.length || 0,
    })),
  };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(options.manifest || defaultManifest);
  if (command === 'check') {
    console.log(JSON.stringify(await checkManifest(manifestPath), null, 2));
    return;
  }
  if (command === 'matched') {
    for (const required of ['a-root', 'b-root', 'a-revision', 'b-revision', 'output']) {
      if (!options[required]) throw new Error(`matched requires --${required}.`);
    }
    const result = await executeMatched({
      manifestPath,
      aRoot: options['a-root'],
      bRoot: options['b-root'],
      aRevision: options['a-revision'],
      bRevision: options['b-revision'],
      pairs: options.pairs,
      output: path.resolve(options.output),
    });
    console.log(JSON.stringify({ output: path.resolve(options.output), summary: result.summary }, null, 2));
    return;
  }
  throw new Error('Usage: benchmark.mjs check [--manifest file] | matched --a-root path --b-root path --a-revision sha --b-revision sha --output file [--pairs 3].');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
