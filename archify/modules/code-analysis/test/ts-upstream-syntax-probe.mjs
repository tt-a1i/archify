// Project original compiler virtual JS inputs onto Archify's syntax/range/call
// inventory. This does not run upstream emit, type-diagnostic or module baselines.
// node test/ts-upstream-syntax-probe.mjs <TypeScript checkout> <report.json>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { configuredProgram } from './ts-official-oracle.mjs';
import { REVISION } from '../extract/ts/index.mjs';

const require = createRequire(import.meta.url);
const [, , checkout, reportFile] = process.argv;
if (!checkout || !reportFile) throw new Error('Pass a TypeScript checkout and report path.');
const upstream = path.resolve(checkout);
const inputs = [];
const collect = directory => {
  for (const entry of fs.readdirSync(path.join(upstream, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(file);
    else if (/\.(?:[mc]?[jt]s|[jt]sx)$/.test(entry.name)) inputs.push(file);
  }
};
const directories = ['tests/cases/compiler', 'tests/cases/conformance'];
for (const directory of directories) {
  if (!fs.statSync(path.join(upstream, directory), { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Missing required upstream fixture directory: ${directory}`);
  }
}
directories.forEach(collect);
const config = { ...loadConfig(null), exclude: [], typescript: { sdk: path.dirname(require.resolve('typescript/package.json')) } };
const results = [];
const point = (source, node) => {
  const a = source.getLineAndCharacterOfPosition(node.getStart(source));
  const b = source.getLineAndCharacterOfPosition(node.getEnd());
  return [a.line + 1, a.character + 1, b.line + 1, b.character + 1];
};
const key = range => JSON.stringify(range);
const sort = values => values.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-upstream-syntax-'));
try {
  for (const upstreamFile of inputs.sort()) {
    const input = fs.readFileSync(path.join(upstream, upstreamFile), 'utf8');
    const virtual = [];
    let current = null;
    for (const line of input.split(/\r?\n/)) {
      const match = /^\s*\/\/\s*@filename:\s*(.+?)\s*$/i.exec(line);
      if (match) { current = { file: match[1], lines: [] }; virtual.push(current); }
      else if (current) current.lines.push(line);
    }
    if (!virtual.length && /\.(?:[mc]?js|jsx)$/i.test(upstreamFile)) virtual.push({ file: path.basename(upstreamFile), lines: input.split(/\r?\n/) });
    const files = virtual.filter(item => /\.(?:[mc]?js|jsx)$/i.test(item.file))
      .map(item => ({ file: path.posix.normalize(item.file.replace(/\\/g, '/').replace(/^[a-z]:/i, '').replace(/^\/+/, '')), source: item.lines.join('\n') }))
      .filter(item => item.file !== '..' && !item.file.startsWith('../') && !item.file.split('/').includes('node_modules'));
    if (!files.length) continue;
    const root = fs.mkdtempSync(path.join(temporary, 'case-'));
    const result = { upstream: upstreamFile, files: files.map(item => item.file), status: '匹配', checkedSources: 0 };
    try {
      for (const item of files) {
        const file = path.join(root, item.file);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, item.source);
      }
      const { options } = configuredProgram(root, null);
      const programOptions = { ...options, noResolve: true, noLib: true, types: [] };
      const program = ts.createProgram(files.map(item => path.join(root, item.file)), programOptions, ts.createCompilerHost(programOptions, true));
      const { facts } = extractFacts(root, { language: 'ts', config });
      assert.deepEqual(facts.files.map(file => file.path), [...new Set(files.map(file => file.file))].sort());
      for (const { file } of files) {
        const source = program.getSourceFile(path.join(root, file));
        assert.ok(source, `official Program did not load ${file}`);
        const broken = program.getSyntacticDiagnostics(source).length > 0;
        assert.equal(Boolean(facts.parse_errors?.some(error => error.path === file)), broken, `${file}: syntax coverage`);
        const functions = new Set(), required = new Set(), calls = [];
        const pending = [source];
        while (pending.length) {
          const node = pending.pop();
          if (ts.isFunctionLike(node) && node.body) {
            const range = key(point(source, node));
            functions.add(range);
            if (node.name || (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name))) required.add(range);
          }
          if (!broken && ts.isCallExpression(node)) calls.push(point(source, node));
          ts.forEachChild(node, child => { pending.push(child); });
        }
        for (const fn of facts.functions.filter(fn => fn.file === file)) {
          const r = fn.sourceRange, range = key([r.line, r.column, r.endLine, r.endColumn]);
          assert.ok(functions.has(range), `${file}: captured function span is not an official AST body`);
          required.delete(range);
        }
        assert.equal(required.size, 0, `${file}: named function bodies omitted: ${[...required].join(', ')}`);
        assert.deepEqual(sort(facts.calls.filter(call => call.file === file).map(call => [call.line, call.column, call.endLine, call.endColumn])), sort(calls), `${file}: call inventory`);
        result.checkedSources += 1;
      }
    } catch (error) {
      result.status = '待修复';
      result.error = error.diagnostics?.[0] || error.message;
      result.stack = error.stack?.split('\n').slice(0, 7);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
    results.push(result);
    if (results.length % 100 === 0) process.stdout.write(`Checked ${results.length} upstream JS fixtures; failures ${results.filter(result => result.status === '待修复').length}\n`);
  }
  assert.ok(results.length, 'No upstream fixtures projected to JavaScript cases');
  const revision = spawnSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const summary = { upstreamCommit: revision.stdout.trim(), sdk: ts.version, node: process.version,
    adapterRevision: REVISION,
    sourceSha256: Object.fromEntries(['index.mjs', 'functions.mjs', 'imported-calls.mjs', 'sdk.mjs', 'snapshot-host.mjs', 'syntax-walk.mjs']
      .map(file => [file, createHash('sha256').update(fs.readFileSync(new URL(`../extract/ts/${file}`, import.meta.url))).digest('hex')])),
    scope: 'compiler and conformance virtual JS inputs outside node_modules; parser, captured function spans and call inventory only',
    scannedInputs: inputs.length,
    cases: results.length, sources: results.reduce((sum, result) => sum + result.checkedSources, 0),
    matched: results.filter(result => result.status === '匹配').length, failed: results.filter(result => result.status === '待修复').length };
  fs.writeFileSync(path.resolve(reportFile), `${JSON.stringify({ ...summary, results }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.failed) process.exitCode = 1;
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
