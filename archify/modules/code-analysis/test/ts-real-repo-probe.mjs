// Manual isolated real-source probe. No target module or package script runs.
// node test/ts-real-repo-probe.mjs <root> <SDK path|auto> <include glob>...
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { extractFacts } from '../lib/analysis.mjs';

const [, , rootArg, sdkArg, ...include] = process.argv;
if (!rootArg || !sdkArg || !include.length) {
  process.stderr.write('Pass a repository root, TypeScript SDK path or auto, and one or more include globs.\n');
  process.exitCode = 2;
} else if (include[0] === '--once') {
  const root = path.resolve(rootArg);
  const config = JSON.parse(fs.readFileSync(new URL('../config/defaults.json', import.meta.url), 'utf8'));
  config.include = include.slice(1);
  config.typescript = { sdk: sdkArg === 'auto' ? 'auto' : path.resolve(sdkArg) };
  const start = performance.now();
  const { facts } = extractFacts(root, { language: 'ts', config });
  const maxRss = process.resourceUsage().maxRSS;
  const factDigest = createHash('sha256').update(JSON.stringify({ files: facts.files, imports: facts.imports,
    functions: facts.functions, calls: facts.calls, parseErrors: facts.parse_errors, unresolved: facts.unresolved })).digest('hex');
  process.stdout.write(`${JSON.stringify({
    elapsedMs: Math.round(performance.now() - start),
    peakRssMb: Math.round(maxRss / 1024),
    sdks: (facts.languageScope?.sdks || []).map(({ version, source, status }) => ({ version, source, status })),
    projects: facts.languageScope?.projects?.length ?? 0,
    files: facts.files.length,
    imports: facts.imports.length,
    resolvedImports: facts.imports.filter(item => item.resolved).length,
    functions: facts.functions.length,
    calls: facts.calls.length,
    boundCalls: facts.calls.filter(item => item.target).length,
    factBytes: Buffer.byteLength(JSON.stringify(facts)),
    callResolutions: Object.fromEntries([...new Set(facts.calls.map(item => item.resolution))].sort()
      .map(resolution => [resolution, facts.calls.filter(item => item.resolution === resolution).length])),
    parseErrors: facts.parse_errors?.length ?? 0,
    unresolved: facts.unresolved,
    factDigest,
  })}\n`);
} else {
  const runs = [];
  for (let i = 0; i < 5; i += 1) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), rootArg, sdkArg, '--once', ...include],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (child.status !== 0) throw new Error(child.stderr || `Probe child exited ${child.status}`);
    runs.push(JSON.parse(child.stdout));
  }
  const inventory = ({ elapsedMs, peakRssMb, ...rest }) => JSON.stringify(rest);
  if (runs.some(run => inventory(run) !== inventory(runs[0]))) throw new Error('Real-source fact counts changed between identical isolated runs.');
  const percentile = (key, rank) => [...runs].map(run => run[key]).sort((a, b) => a - b)[Math.ceil(rank * runs.length) - 1];
  process.stdout.write(`${JSON.stringify({ root: path.resolve(rootArg), platform: process.platform, node: process.version,
    sdkRequest: sdkArg, include, runs: runs.length, inventory: JSON.parse(inventory(runs[0])),
    elapsedMs: { p50: percentile('elapsedMs', 0.5), p95: percentile('elapsedMs', 0.95) },
    peakRssMb: { p50: percentile('peakRssMb', 0.5), p95: percentile('peakRssMb', 0.95) } })}\n`);
}
