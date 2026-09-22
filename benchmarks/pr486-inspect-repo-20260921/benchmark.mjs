import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(repoRoot, 'archify/bin/archify.mjs');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-inspect-benchmark-'));
const snapshots = new Set();
const git = (...args) => {
  const result = spawnSync('git', ['-C', fixtureRoot, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};
const inspect = (args) => {
  const start = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [cli, 'inspect-repo', fixtureRoot, '--batch-size', '20', '--json', ...args], { encoding: 'utf8' });
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  if (data.session.snapshot) snapshots.add(path.dirname(data.session.snapshot));
  return { elapsedMs, bytes: Buffer.byteLength(result.stdout), data };
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

try {
  for (let module = 0; module < 40; module += 1) {
    const directory = path.join(fixtureRoot, 'packages', `p${String(module).padStart(2, '0')}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: `p${module}`, main: 'src/main.js' }));
    const source = path.join(directory, 'src');
    fs.mkdirSync(source);
    for (let file = 0; file < 50; file += 1) {
      fs.writeFileSync(path.join(source, `f${String(file).padStart(2, '0')}.js`), `export const value = ${file};\n`);
    }
  }
  git('init', '--quiet');
  git('add', '.');
  git('-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '--quiet', '-m', 'fixed fixture');

  const first = inspect(['--batch', '1']);
  const snapshot = first.data.session.snapshot;
  const cached = [];
  const uncached = [];
  let secondPageFiles;
  // Alternate order so filesystem cache warming does not favor one side.
  for (let repetition = 0; repetition < 5; repetition += 1) {
    const order = repetition % 2 === 0 ? ['cached', 'uncached'] : ['uncached', 'cached'];
    for (const variant of order) {
      const result = inspect(variant === 'cached'
        ? ['--batch', '2', '--snapshot', snapshot]
        : ['--batch', '2']);
      assert.equal(result.data.coverage.batch, 2);
      if (secondPageFiles) assert.deepEqual(result.data.files, secondPageFiles);
      else secondPageFiles = result.data.files;
      (variant === 'cached' ? cached : uncached).push(result.elapsedMs);
    }
  }
  const result = {
    fixture: '40 packages; 50 JavaScript source files plus one package.json in each; 2,040 tracked files',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    repetitions: 5,
    firstPage: {
      elapsedMs: Number(first.elapsedMs.toFixed(1)),
      bytes: first.bytes,
      surfacedFiles: first.data.files.length,
      inventoryTotal: first.data.coverage.fileInventory.total,
      configurationTotal: first.data.level1.candidateFiles,
    },
    secondPage: {
      cachedMs: cached.map((value) => Number(value.toFixed(1))),
      uncachedMs: uncached.map((value) => Number(value.toFixed(1))),
      cachedMedianMs: Number(median(cached).toFixed(1)),
      uncachedMedianMs: Number(median(uncached).toFixed(1)),
    },
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const directory of snapshots) fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
