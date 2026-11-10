// C6 contracts: real detection is opt-in via ARCHIFY_TEST_JSCPD. Executable
// doubles below inject process/report failures; they are not clone detectors.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildGraph, evaluateGraph, extractFacts, loadConfig } from '../lib/analysis.mjs';
import { evaluate } from '../evaluate/index.mjs';
import { comparability } from '../lib/review.mjs';
import { DiagnosticError } from '../extract/shared/diagnostics.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { startAnalysisView } from '../bin/serve.mjs';
import { ARCHIFY_AVAILABLE } from './helpers.mjs';

const CODE = 'redundancy/duplicate-block';
const CHECK = fileURLToPath(new URL('../bin/check.mjs', import.meta.url));
const POSIX_ONLY = process.platform === 'win32' ? 'executable fault scripts use a POSIX shebang; CLI missing-tool contract still runs' : false;
const REAL_TOOL = process.env.ARCHIFY_TEST_JSCPD;
const SOURCE = `function summarize(values, floor) {
  let total = 0;
  let accepted = 0;
  for (const value of values) {
    if (value > floor) {
      total += value;
      accepted += 1;
    } else {
      total -= floor;
    }
  }
  if (accepted === 0) return -1;
  const average = Math.floor(total / accepted);
  if (average > 100) return 100;
  const adjustment = average % 7;
  if (adjustment === 0) return average + 1;
  return average;
}
`;
const NEGATIVE = `export function transform(point, scale, angle) {
  const horizontal = point.x * scale;
  const vertical = point.y * scale;
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  const rotatedX = horizontal * cosine - vertical * sine;
  const rotatedY = horizontal * sine + vertical * cosine;
  const distance = Math.hypot(rotatedX, rotatedY);
  const direction = Math.atan2(rotatedY, rotatedX);
  const label = String(distance) + ':' + String(direction);
  return { x: rotatedX, y: rotatedY, distance, direction, label };
}
`;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-duplicates-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'source with spaces');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'original.js'), SOURCE);
  fs.writeFileSync(path.join(root, 'copy.js'), SOURCE.replace('summarize', 'copied'));
  fs.writeFileSync(path.join(root, 'renamed.js'), SOURCE.replaceAll('summarize', 'renamed').replaceAll('values', 'items').replaceAll('floor', 'limit').replaceAll('total', 'sum').replaceAll('accepted', 'count').replaceAll('average', 'mean').replaceAll('adjustment', 'remainder'));
  fs.writeFileSync(path.join(root, 'negative.js'), NEGATIVE);
  const config = loadConfig(null);
  const { facts } = extractFacts(root, { language: 'ts', config });
  return { dir, root, config, facts, graph: buildGraph(facts, config) };
}

function enabled(executable, overrides = {}) {
  return { enabled: true, executable, minTokens: 50, minLines: 5, identifiers: 'consistent', timeoutMs: 30000, maxFileBytes: 1000000, ...overrides };
}

function analyze(input, duplicates, extra = {}) {
  return evaluateGraph(input.graph, { ...input.config, ...(duplicates === undefined ? {} : { duplicates }), ...extra }, input.facts);
}

function diagnostic(code) {
  return error => error instanceof DiagnosticError && error.diagnostics?.[0]?.code === code;
}

function faultTool(dir, name, body, version = '5.4.3') {
  const executable = path.join(dir, `${name}.cjs`);
  const calls = `${executable}.calls`;
  fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, cwd: process.cwd(), pid: process.pid }) + '\\n');
if (args.includes('--version')) { console.log('jscpd ${version}'); process.exit(0); }
${body}
`);
  fs.chmodSync(executable, 0o755);
  return { executable, calls };
}

// Only used to construct malformed reports. The valid inventory fields keep
// these cases focused on the corruption under test instead of an earlier shape error.
const REPORT_SETUP = `
function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : args.find(arg => arg.startsWith(name + '='))?.slice(name.length + 1);
}
const output = option('--output') || option('-o');
if (!output) throw new Error('fault fixture requires an explicit report directory');
const roots = args.filter(arg => { try { return fs.statSync(arg).isDirectory() && path.resolve(arg) !== path.resolve(output); } catch { return false; } });
const input = roots[0] || process.cwd();
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []); }
const files = walk(input).sort().map(file => ({ path: file, tokens: 200, lines: fs.readFileSync(file, 'utf8').trimEnd().split('\\n').length, size: fs.statSync(file).size, complexity: 1, duplicatedLines: 0, duplicationPercentage: 0 }));
const report = { duplicates: [], statistics: { total: { sources: files.length } }, summary: { files, totalFiles: files.length } };
fs.mkdirSync(output, { recursive: true });
const reportFile = path.join(output, (option('--report-name') || 'jscpd-report') + '.json');
`;

test('duplicates: default-off and ignored rules never execute the optional tool', t => {
  const input = fixture(t);
  const executable = path.join(input.dir, 'must-not-be-looked-up');
  const original = analyze(input);
  for (const config of [{ enabled: false, executable }, enabled(executable)]) {
    const ignored = config.enabled ? { ignore: [CODE] } : {};
    const result = analyze(input, config, ignored);
    assert.deepEqual(result.diagnostics, original.diagnostics);
    assert.equal(result.analysis.duplicates, undefined, 'even a version probe would fail for this nonexistent executable');
  }
  assert.equal(original.analysis.duplicates, undefined);
  assert.equal(original.rules.includes(CODE), false);
  assert.deepEqual(schemaErrors('findings', original), []);
});

test('duplicates: invalid enabled configuration fails explicitly', t => {
  const input = fixture(t);
  const missing = path.join(input.dir, 'not-installed');
  for (const override of [{ enabled: 'yes' }, { minTokens: 0 }, { minLines: 0 }, { identifiers: 'blind' }, { timeoutMs: 0 }, { maxFileBytes: 0 }, { executable: 42 }]) {
    assert.throws(() => analyze(input, enabled(missing, override)), diagnostic('duplicates/config-invalid'), JSON.stringify(override));
  }
});

test('duplicates: missing captured source is not silently read from disk', { skip: POSIX_ONLY }, t => {
  const input = fixture(t);
  const tool = faultTool(input.dir, 'source-missing', 'process.exit(91);');
  const facts = structuredClone(input.facts);
  delete facts.files[0].sourceText;
  assert.throws(() => evaluate(input.graph, { ...input.config, duplicates: enabled(tool.executable) }, facts),
    diagnostic('duplicates/source-unavailable'));
  if (fs.existsSync(tool.calls)) {
    const calls = fs.readFileSync(tool.calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(calls.every(call => call.args.includes('--version')), 'no scan can repair missing captured source');
  }
});

test('duplicates: missing executable is an analysis failure', t => {
  const input = fixture(t);
  assert.throws(() => analyze(input, enabled(path.join(input.dir, 'not-installed'))), diagnostic('duplicates/tool-unavailable'));
});

test('duplicates: wrong version, process failure, and timeout cannot become empty findings', { skip: POSIX_ONLY }, t => {
  const input = fixture(t);
  const wrong = faultTool(input.dir, 'wrong-version', 'process.exit(0);', '5.4.2');
  assert.throws(() => analyze(input, enabled(wrong.executable)), diagnostic('duplicates/tool-version'));
  const failed = faultTool(input.dir, 'failed', "console.error('injected scanner failure'); process.exit(7);");
  assert.throws(() => analyze(input, enabled(failed.executable)), diagnostic('duplicates/tool-failed'));
  const hung = faultTool(input.dir, 'hung', 'setInterval(() => {}, 1000);');
  assert.throws(() => analyze(input, enabled(hung.executable, { timeoutMs: 1000 })), diagnostic('duplicates/tool-failed'));
  const calls = fs.readFileSync(hung.calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.some(call => !call.args.includes('--version')), 'the actual scan reached the timeout control');
});

test('duplicates: a timed-out POSIX launcher also stops its scanner child', { skip: POSIX_ONLY, timeout: 20000 }, async t => {
  const input = fixture(t);
  const pidFile = path.join(input.dir, 'scanner.pid');
  const child = path.join(input.dir, 'scanner.cjs');
  // Match the official npm launcher's spawnSync/stdio boundary. The bounded
  // child is a process-lifecycle fault injection, not a clone detector.
  fs.writeFileSync(child, `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setTimeout(() => {}, 30000);
`);
  const launcher = faultTool(input.dir, 'launcher', `
const result = require('node:child_process').spawnSync(process.execPath, [${JSON.stringify(child)}], { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
  let childPid;
  const alive = () => {
    try { process.kill(childPid, 0); return true; } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  try {
    // Allow both Node processes to start on a busy test worker. The readiness
    // file and call log distinguish a scan timeout from a version-probe timeout.
    assert.throws(() => analyze(input, enabled(launcher.executable, { timeoutMs: 5000 })), error =>
      diagnostic('duplicates/tool-failed')(error) && error.diagnostics[0].evidence.reason === 'ETIMEDOUT');
    const calls = fs.readFileSync(launcher.calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(calls.some(call => !call.args.includes('--version')), 'the timeout reached the scan invocation');
    assert.ok(fs.existsSync(pidFile), 'the scan child reported readiness within the test startup budget');
    childPid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(Number.isSafeInteger(childPid) && childPid > 0 && childPid !== process.pid, 'the scanner child started');
    const deadline = Date.now() + 1000;
    while (alive() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(alive(), false, 'the launcher timeout must terminate the child before its own 30-second lifetime');
  } finally {
    // Clean up even when the product regresses or a diagnostic assertion fails.
    if (!childPid && fs.existsSync(pidFile)) childPid = Number(fs.readFileSync(pidFile, 'utf8'));
    if (Number.isSafeInteger(childPid) && childPid > 0 && childPid !== process.pid) {
      try { process.kill(childPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
});

test('duplicates: malformed JSON and paths outside the snapshot are rejected', { skip: POSIX_ONLY }, t => {
  const input = fixture(t);
  const malformed = faultTool(input.dir, 'malformed', `${REPORT_SETUP}\nfs.writeFileSync(reportFile, '{');`);
  assert.throws(() => analyze(input, enabled(malformed.executable)), diagnostic('duplicates/report-invalid'));
  const outside = faultTool(input.dir, 'outside', `${REPORT_SETUP}
report.summary.files[0].path = path.join(input, '..', 'outside.js');
fs.writeFileSync(reportFile, JSON.stringify(report));`);
  assert.throws(() => analyze(input, enabled(outside.executable)), diagnostic('duplicates/report-invalid'));
  const inconsistent = faultTool(input.dir, 'count-mismatch', `${REPORT_SETUP}
report.statistics.total.sources += 1;
fs.writeFileSync(reportFile, JSON.stringify(report));`);
  assert.throws(() => analyze(input, enabled(inconsistent.executable)), diagnostic('duplicates/report-invalid'));
});

test('duplicates: null report objects and entries remain structured report failures', { skip: POSIX_ONLY }, t => {
  const input = fixture(t);
  for (const [name, corruption] of [
    ['null-report', "fs.writeFileSync(reportFile, 'null');"],
    ['null-inventory-entry', 'report.summary.files[0] = null; fs.writeFileSync(reportFile, JSON.stringify(report));'],
    ['null-duplicate', 'report.duplicates = [null]; fs.writeFileSync(reportFile, JSON.stringify(report));'],
  ]) {
    const tool = faultTool(input.dir, name, `${REPORT_SETUP}\n${corruption}`);
    assert.throws(() => analyze(input, enabled(tool.executable)), diagnostic('duplicates/report-invalid'), name);
  }
});

function check(args, cwd) {
  const result = spawnSync(process.execPath, [CHECK, ...args, '--json'], { cwd, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.error, undefined, result.error?.message);
  return { ...result, receipt: JSON.parse(result.stdout) };
}

test('duplicates: CLI failure preserves previous output and never updates the baseline', t => {
  const input = fixture(t);
  const out = path.join(input.dir, 'analysis');
  const baseline = path.join(input.dir, 'baseline.json');
  const configFile = path.join(input.dir, 'config.json');
  const first = check([input.root, '--language', 'ts', '--out', out, '--fail-on', 'never'], input.dir);
  assert.equal(first.status, 0, first.stderr);
  fs.writeFileSync(baseline, JSON.stringify({ schema_version: 1, accepted: [] }) + '\n');
  const saved = new Map(fs.readdirSync(out).map(name => [name, fs.readFileSync(path.join(out, name))]));
  const baselineBytes = fs.readFileSync(baseline);
  fs.writeFileSync(configFile, JSON.stringify({ duplicates: enabled(path.join(input.dir, 'not-installed')) }));
  for (const flags of [[], ['--update-baseline']]) {
    const result = check([input.root, '--language', 'ts', '--config', configFile, '--out', out, '--baseline', baseline, '--fail-on', 'never', ...flags], input.dir);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(result.receipt.status, 'error');
    assert.equal(result.receipt.diagnostics[0].code, 'duplicates/tool-unavailable');
    assert.deepEqual(fs.readdirSync(out).sort(), [...saved.keys()].sort());
    for (const [name, bytes] of saved) assert.deepEqual(fs.readFileSync(path.join(out, name)), bytes, name);
    assert.deepEqual(fs.readFileSync(baseline), baselineBytes);
  }
});

test('duplicates: service worker failure preserves the last successful analysis', { skip: !ARCHIFY_AVAILABLE && 'needs an Archify checkout', timeout: 30000 }, async t => {
  const input = fixture(t);
  const ir = path.join(input.dir, 'architecture.json');
  const out = path.join(input.dir, 'view');
  const config = path.join(input.dir, 'config.json');
  fs.writeFileSync(config, '{}');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Duplicates', output: 'architecture.html' },
    components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [170, 64] }], connections: [] }));
  const view = await startAnalysisView([input.root, '--ir', ir, '--out', out, '--language', 'ts', '--config', config]);
  t.after(() => new Promise(resolve => { view.server.close(resolve); view.server.closeAllConnections?.(); }));
  const headers = { Origin: view.url, 'X-Analysis-Token': view.token };
  const initial = await fetch(view.url + '/analyze', { method: 'POST', headers });
  assert.equal(initial.status, 200);
  await initial.text();
  const analysis = path.join(out, 'analysis');
  const saved = new Map(fs.readdirSync(analysis).map(name => [name, fs.readFileSync(path.join(analysis, name))]));
  fs.writeFileSync(config, JSON.stringify({ duplicates: enabled(path.join(input.dir, 'not-installed')) }));
  const failed = await fetch(view.url + '/analyze', { method: 'POST', headers: { ...headers, 'X-Analysis-Refresh': '1' } });
  assert.equal(failed.status, 500);
  assert.equal((await failed.json()).diagnostics[0].code, 'duplicates/tool-unavailable');
  for (const [name, bytes] of saved) assert.deepEqual(fs.readFileSync(path.join(analysis, name)), bytes, name);
  assert.equal(fs.readdirSync(out).some(name => name.startsWith('analysis.next-')), false);
  fs.writeFileSync(config, '{}');
  const retried = await fetch(view.url + '/analyze', { method: 'POST', headers });
  assert.equal(retried.status, 200, 'pending state clears after the worker failure');
  await retried.text();
});

test('duplicates: real jscpd detects all clone members from captured source and excludes the independent negative', {
  skip: !REAL_TOOL && 'set ARCHIFY_TEST_JSCPD to the installed jscpd 5.4.3 binary; process doubles do not establish detection',
}, t => {
  const input = fixture(t);
  const config = enabled(path.resolve(REAL_TOOL));
  const findings = analyze(input, config);
  assert.deepEqual(schemaErrors('findings', findings), []);
  const duplicates = findings.diagnostics.filter(finding => finding.code === CODE);
  assert.ok(duplicates.length > 0);
  const members = [...new Set(duplicates.flatMap(finding => finding.subject.files))].sort();
  assert.deepEqual(members, ['copy.js', 'original.js', 'renamed.js']);
  assert.deepEqual(findings.analysis.duplicates.engine, { name: 'jscpd', version: '5.4.3', adapterRevision: 2 });
  assert.deepEqual(findings.analysis.duplicates.coverage.analyzed, input.facts.files.map(file => file.path).sort());
  assert.equal(findings.analysis.duplicates.coverage.complete, true);
  const historical = structuredClone(findings.analysis);
  historical.duplicates.engine = { name: 'jscpd', version: '5.4.2', adapterRevision: 1 };
  const upgraded = comparability(historical, findings.analysis);
  assert.equal(upgraded.comparable, false, 'an engine/adapter upgrade cannot establish that a clone was fixed');
  assert.ok(upgraded.reasons.some(reason => reason.code === 'duplicates-engine-changed'));
  const before = duplicates.map(finding => ({ id: finding.id, digest: finding.evidenceDigest }));
  fs.writeFileSync(path.join(input.root, 'renamed.js'), 'export const changedAfterCapture = true;\n');
  const captured = analyze(input, config);
  assert.deepEqual(captured.diagnostics.filter(finding => finding.code === CODE).map(finding => ({ id: finding.id, digest: finding.evidenceDigest })), before,
    'C6 must consume the captured facts, not reread the changed working tree');
  assert.equal(comparability(findings.analysis, captured.analysis).comparable, true);
  const exact = analyze(input, enabled(path.resolve(REAL_TOOL), { identifiers: 'exact' }));
  assert.deepEqual([...new Set(exact.diagnostics.filter(finding => finding.code === CODE).flatMap(finding => finding.subject.files))].sort(),
    ['copy.js', 'original.js'], 'removing consistent normalization loses only the renamed member in this fixture');
  assert.equal(comparability(findings.analysis, exact.analysis).comparable, false);
});

test('duplicates: real threshold omissions retain candidates and make comparisons explicitly incomplete', {
  skip: !REAL_TOOL && 'set ARCHIFY_TEST_JSCPD to exercise native partial-scan behavior',
}, t => {
  const input = fixture(t);
  const config = enabled(path.resolve(REAL_TOOL));
  const complete = analyze(input, config);
  fs.writeFileSync(path.join(input.root, 'short.js'), 'export const tiny = 1;\n');
  const { facts } = extractFacts(input.root, { language: 'ts', config: input.config });
  const partial = analyze({ ...input, facts, graph: buildGraph(facts, input.config) }, config);
  const coverage = partial.analysis.duplicates.coverage;
  assert.equal(coverage.complete, false);
  assert.ok(coverage.selected.includes('short.js'));
  assert.equal(coverage.analyzed.includes('short.js'), false);
  assert.ok(coverage.omitted.some(entry => entry.file === 'short.js' && typeof entry.reason === 'string' && entry.reason.length));
  assert.ok(partial.diagnostics.some(finding => finding.code === CODE), 'valid clone evidence survives a bounded scan');
  assert.equal(comparability(complete.analysis, partial.analysis).comparable, false);
  assert.equal(comparability(partial.analysis, partial.analysis).comparable, false, 'two identically incomplete runs do not establish complete coverage');
  const empty = analyze(input, enabled(path.resolve(REAL_TOOL), { maxFileBytes: 1 }));
  assert.deepEqual(empty.analysis.duplicates.coverage.analyzed, []);
  assert.equal(empty.analysis.duplicates.coverage.complete, false);
  assert.equal(empty.diagnostics.some(finding => finding.code === CODE), false);
});
