// Replay the reviewed mapping failures through the normal CLI, then follow a
// structural lead on the same Archify source tree for source/ZIP comparison.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  assert.ok(['--cli', '--baseline-cli', '--root', '--out'].includes(key) && process.argv[i + 1], `Unknown or incomplete option: ${key}`);
  options[key] = path.resolve(process.argv[i + 1]);
}
assert.ok(options['--out'], 'Pass --out <evidence-directory>.');
const out = options['--out'];
const cli = options['--cli'] || path.join(repo, 'archify/bin/archify.mjs');
const root = options['--root'] || path.join(repo, 'archify');
fs.mkdirSync(out, { recursive: true });

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}

function command(binary, args, name) {
  const run = spawnSync(process.execPath, [binary, 'code-analysis', ...args], {
    encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024,
  });
  write(path.join(out, `${name}.command.json`), { node: process.version, cli: binary, args, exit: run.status, error: run.error?.message || null });
  write(path.join(out, `${name}.json`), run.stdout || '');
  write(path.join(out, `${name}.stderr.txt`), run.stderr || '');
  assert.equal(run.status, 0, `${name}: ${run.error?.message || run.stderr || run.stdout}`);
  return JSON.parse(run.stdout);
}

const cases = [
  {
    name: 'go-directory', language: 'go', expected: 2,
    files: {
      'go.mod': 'module example.com/review\n\ngo 1.18\n',
      'cmd/app/main.go': 'package main\nimport "example.com/review/pkg/core"\nfunc main() { core.Run() }\n',
      'pkg/core/core.go': 'package core\nfunc Run() {}\n',
    },
    sources: ['cmd/app/', 'pkg/core/'], config: { go: { stdlib: false } },
  },
  {
    name: 'rust-directory', language: 'rust', expected: 1,
    files: {
      'Cargo.toml': '[package]\nname = "review-demo"\nversion = "0.1.0"\nedition = "2021"\n',
      'src/lib.rs': 'pub fn run() -> usize { 1 }\n',
    },
    sources: ['src/'], config: {},
  },
  {
    name: 'root-directory', language: 'ts', expected: 1,
    files: {
      'src/a.mjs': 'export const a = 1;\n',
      'tools/use.mjs': 'import { a } from "../src/a.mjs";\nexport const value = a;\n',
    },
    sources: ['.'], config: {},
  },
];
const result = { baseline: {}, candidate: {} };
const binaries = options['--baseline-cli'] ? [['baseline', options['--baseline-cli']], ['candidate', cli]] : [['candidate', cli]];
for (const fixture of cases) {
  const dir = path.join(out, 'fixtures', fixture.name);
  for (const [file, text] of Object.entries(fixture.files)) write(path.join(dir, file), text);
  const ir = path.join(dir, 'architecture.json');
  const config = path.join(dir, 'config.json');
  write(ir, {
    schema_version: 1, diagram_type: 'architecture', meta: { title: fixture.name, output: 'out.html' },
    components: fixture.sources.map((source, i) => ({ id: `component-${i}`, type: 'backend', label: source, sources: [{ path: source }] })),
    connections: [],
  });
  write(config, fixture.config);
  for (const [name, binary] of binaries) {
    const check = command(binary, ['check', dir, '--language', fixture.language, '--config', config, '--ir', ir, '--fail-on', 'never', '--json'], `${name}-${fixture.name}`);
    result[name][fixture.name] = check.diagram;
    if (name === 'candidate') {
      assert.equal(check.diagram.mappedComponents, fixture.expected, fixture.name);
      assert.deepEqual(check.diagram.unmappedModules, []);
      assert.deepEqual(check.diagram.ambiguousModules, []);
    }
  }
}

const shared = path.join(out, 'fixtures/shared-module');
for (const [file, text] of Object.entries({
  'src/client/index.mjs': 'import { a } from "../shared/a.mjs";\nexport const run = a;\n',
  'src/shared/a.mjs': 'export const a = 1;\n',
  'src/shared/b.mjs': 'export const b = 2;\n',
})) write(path.join(shared, file), text);
const components = [
  { id: 'client', type: 'backend', label: 'Client', sources: [{ path: 'src/client/index.mjs' }] },
  { id: 'a', type: 'backend', label: 'A', sources: [{ path: 'src/shared/a.mjs' }] },
  { id: 'b', type: 'backend', label: 'B', sources: [{ path: 'src/shared/b.mjs' }] },
];
for (const [name, binary] of binaries) {
  result[name].sharedModule = [];
  for (const [index, order] of [components, [components[0], components[2], components[1]]].entries()) {
    const ir = path.join(shared, `order-${index}.json`);
    write(ir, { schema_version: 1, diagram_type: 'architecture', meta: { title: 'Shared module', output: 'out.html' }, components: order, connections: [{ from: 'client', to: 'a' }] });
    const check = command(binary, ['check', shared, '--language', 'ts', '--ir', ir, '--fail-on', 'never', '--json'], `${name}-shared-${index}`);
    result[name].sharedModule.push(check.diagram);
    if (name === 'candidate') {
      assert.deepEqual(check.diagram.undeclaredEdges, []);
      assert.deepEqual(check.diagram.ambiguousModules, [{ id: 'src-shared', components: ['a', 'b'] }]);
    }
  }
  if (name === 'candidate') assert.deepEqual(result[name].sharedModule[0], result[name].sharedModule[1]);
}

const analysis = path.join(out, 'self-analysis');
const args = ['check', root, '--language', 'ts', '--out', analysis, '--fail-on', 'never', '--json'];
const first = command(cli, args, 'self-first');
assert.equal(first.counts.offDiagram, null);
const brief = first.investigation.architecture;
const leak = [...first.investigation.leads, ...brief.structuralSignals].find((lead) => lead.code === 'coupling/internal-leak');
assert.ok(leak, 'The fixed Archify investigation has an internal-leak lead.');
const task = command(cli, ['task', analysis, '--finding', leak.id, '--root', root, '--format', 'json', '--require-valid'], 'self-task');
assert.equal(task.evidence.status, 'valid');
const second = command(cli, args, 'self-reanalysis');
assert.equal(second.review.comparison.new, 0);
assert.equal(second.review.comparison.notDetected, 0);
const aligned = command(cli, [...args, '--ir', path.join(here, 'archify-self.architecture.json')], 'self-diagram');
assert.equal(aligned.diagram.mappedComponents, 4);
assert.deepEqual(aligned.diagram.ambiguousModules, []);
result.self = {
  files: first.files, coverage: first.coverage, modules: brief.modules, edges: brief.edges,
  evidence: task.evidence.status, reanalysis: second.review.comparison, diagram: aligned.diagram,
};
write(path.join(out, 'summary.json'), result);
console.log(JSON.stringify(result, null, 2));
