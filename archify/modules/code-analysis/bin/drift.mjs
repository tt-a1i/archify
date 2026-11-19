#!/usr/bin/env node
import fs from 'node:fs';

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DiagnosticError, fail, receipt } from '../core/index.mjs';
import { ensureDependencies } from './serve.mjs';
import { assertDriftPin, captureDriftTree, driftRepository } from '../lib/drift-capture.mjs';
import { driftReportMaxBytes, readDriftInput } from '../lib/drift-input.mjs';
import { validateDriftFollowup } from '../lib/drift-verification.mjs';
import { driftDigest } from '../lib/architecture-drift.mjs';
import { containedBy } from '../../../renderers/shared/path-semantics.mjs';
import { resolveNativeOutputDirectory } from '../../../renderers/shared/output-path.mjs';
import { createOwnedTempDirectory } from '../../../renderers/shared/owned-temp-directory.mjs';

const usage = 'Usage: archify code-analysis drift <git-repo> --base <full-sha> --head <full-sha> --ir <architecture.json> --out <new-directory> [--map file] [--config file] [--from-report <original-drift.json>] [--locale en|zh-CN] [--json]';
const allowed = new Set(['--base', '--head', '--ir', '--out', '--map', '--config', '--locale', '--from-report']);
const archify = fileURLToPath(new URL('../../../bin/archify.mjs', import.meta.url));

function parse(repo, args) {
  const options = new Map();
  const invalid = () => fail('drift/usage', usage);
  if (!repo || repo.startsWith('-')) invalid();
  while (args.length) {
    const key = args.shift();
    if (options.has(key)) invalid();
    if (key === '--json') { options.set(key, true); continue; }
    if (!allowed.has(key) || !args.length || args[0].startsWith('--') || !args[0]) invalid();
    options.set(key, args.shift());
  }
  if (['--base', '--head', '--ir', '--out'].some(k => !options.has(k)) ||
      (options.has('--locale') && !['en', 'zh-CN'].includes(options.get('--locale')))) invalid();
  return options;
}

function outputPath(raw, repo) {
  const abs = resolveNativeOutputDirectory(raw);
  if (path.basename(abs) === '' || /[:\u0000-\u001f]/.test(path.basename(abs))) fail('drift/output-invalid', 'Select a new output directory.');
  const target = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  if (containedBy(repo, target).status !== 'different' || fs.existsSync(target)) fail('drift/output-invalid', 'Select a new output directory outside the input repository.');
  return target;
}

function publish(target, json, html) {
  // Exclusive output directory and files. Existing user files are never replaced.
  fs.mkdirSync(target);
  const written = [];
  try {
    for (const [name, data] of [['architecture-drift.json', json], ['architecture-drift.html', html]]) {
      const file = path.join(target, name);
      const fd = fs.openSync(file, 'wx');
      written.push(file);
      try { fs.writeFileSync(fd, data); } finally { fs.closeSync(fd); }
    }
  } catch (e) {
    for (const file of written) fs.unlinkSync(file);
    fs.rmdirSync(target);
    throw e;
  }
}

async function run([repoArg, ...args]) {
  if (!repoArg || ['-h', '--help'].includes(repoArg)) { console.log(usage); return; }
  const options = parse(repoArg, args);
  const repo = driftRepository(repoArg);
  const pins = { base: options.get('--base'), head: options.get('--head') };
  for (const [side, oid] of Object.entries(pins)) assertDriftPin(repo, oid, side);
  const out = outputPath(options.get('--out'), repo);
  const irInput = readDriftInput(options.get('--ir'), 'ir');
  const map = options.has('--map') ? readDriftInput(options.get('--map'), 'map').doc : null;
  const custom = options.has('--config') ? readDriftInput(options.get('--config'), 'config').doc : null;
  if (options.has('--config') && (!custom || typeof custom !== 'object' || Array.isArray(custom))) fail('drift/config-invalid', 'Select an analysis configuration object.');
  if (options.has('--map') && map === null) fail('drift/map-invalid', 'Select an overlay map object.');
  const ir = irInput.doc;
  if (!ir || ir.diagram_type !== 'architecture') fail('drift/ir-invalid', 'Select a valid authored Architecture IR.');
  const irSha256 = driftDigest(irInput.bytes);
  let originalInputs = null;
  if (options.has('--from-report')) {
    originalInputs = validateDriftFollowup(readDriftInput(options.get('--from-report'), 'original', driftReportMaxBytes),
      pins, ir.meta?.repository?.revision, irSha256);
  } else if (ir.meta?.repository) {
    const revision = ir.meta.repository.revision;
    if (revision !== pins.base && revision !== pins.head) fail('drift/ir-pin-mismatch', 'The authored IR pins a different Git revision.', {
      supportedFixes: ['use the intended Architecture IR and its corresponding base or head capture'],
    });
  }
  const locale = options.get('--locale') || (ir.meta?.locale === 'zh-CN' ? 'zh-CN' : 'en');
  const temp = createOwnedTempDirectory('archify-drift-');
  const scratch = temp.path;
  let output;
  try {
    const inputFile = path.join(scratch, 'architecture.json');
    const delivered = path.join(scratch, 'architecture.html');
    fs.writeFileSync(inputFile, irInput.bytes);
    const draw = spawnSync(process.execPath, [archify, 'deliver', 'architecture', inputFile, delivered, '--json',
      ...(ir.meta?.repository ? ['--repo-root', repo] : [])], { encoding: 'utf8', timeout: 90_000, windowsHide: true });
    if (draw.status !== 0 || draw.error) {
      let diagnostics;
      try { diagnostics = JSON.parse(draw.stdout).diagnostics; } catch { /* structured fallback below */ }
      if (diagnostics?.length) throw new DiagnosticError('Architecture validation failed.', diagnostics);
      fail('drift/diagram-invalid', 'Archify could not deliver the authored Architecture diagram.');
    }
    await ensureDependencies();
    const { extractFacts, buildGraph, loadConfig, mergeConfig, stableJson } = await import('../lib/analysis.mjs');
    const { compareArchitectureDrift, checkDriftMapping } = await import('../lib/architecture-drift.mjs');
    const { renderDriftOverlay } = await import('../overlay/drift.mjs');
    checkDriftMapping(ir, map);
    const config = custom ? mergeConfig(loadConfig(null), custom) : loadConfig(null);
    const configSha256 = driftDigest(stableJson(config));
    const mapSha256 = driftDigest(stableJson(map));
    if (originalInputs && (originalInputs.configSha256 !== configSha256 || originalInputs.mapSha256 !== mapSha256)) {
      fail('drift-verification/mismatched-followup', 'Reuse the original component mapping and effective analysis configuration for this follow-up.');
    }
    const captures = {};
    for (const [side, oid] of Object.entries(pins)) {
      const root = path.join(scratch, side);
      const omitted = captureDriftTree(repo, oid, root);
      const resolutionInputs = new Map();
      const { facts } = extractFacts(root, { language: 'ts', config, capturedOnly: true, onCapture({ reads }) {
        for (const [file, content] of reads) {
          if (content === undefined) continue;
          const relative = path.relative(root, file).split(path.sep).join('/');
          if (relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative)) {
            resolutionInputs.set(relative, driftDigest(content));
          }
        }
      } });
      const tsconfig = 'tsconfig.json';
      if (!resolutionInputs.has(tsconfig)) resolutionInputs.set(tsconfig, null);
      if (!facts.files.length) fail('drift/no-sources', 'No JS/TS source files were selected.', { subject: { side } });
      if (facts.repository.sourceKind !== 'working-tree' || facts.repository.revision !== null || facts.repository.root !== '.') {
        fail('drift/capture-context', 'The isolated tree was interpreted as a different repository.');
      }
      captures[side] = { facts, omitted, resolutionInputs, graph: buildGraph(facts, config) };
    }
    const result = compareArchitectureDrift({ ...captures, ir: { ...ir, connections: ir.connections || [] }, map, pins, locale, inputs: {
      irSha256, configSha256, mapSha256,
      analyzer: captures.head.facts.repository.adapter, adapterRevision: captures.head.facts.repository.adapterRevision,
    } });
    const json = stableJson(result);
    output = { result, json, html: renderDriftOverlay(fs.readFileSync(delivered, 'utf8'), result, driftDigest(json)) };
  } finally { await temp.cleanup(); }
  publish(out, output.json, output.html);
  if (options.has('--json')) process.stdout.write(output.json);
  else console.log('Architecture drift: ' + output.result.summary.newUndeclared + ' newly observed undeclared pair(s); ' +
    output.result.summary.inconclusive + ' inconclusive. Open ' + path.join(out, 'architecture-drift.html'));
}

try { await run(process.argv.slice(2)); }
catch (err) {
  const diagnostics = err instanceof DiagnosticError ? err.diagnostics : [{
    code: 'drift/failed', severity: 'error', message: 'Could not compare or publish the pinned architecture review.',
    subject: {}, evidence: { reason: err.code || 'unexpected-error' }, supportedFixes: ['verify the Git repository, inputs and fresh output path'],
  }];
  console.log(JSON.stringify(receipt('error', { command: 'drift', diagnostics }), null, 2));
  process.exitCode = 2;
}
