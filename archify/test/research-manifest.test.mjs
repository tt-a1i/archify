import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'archify.mjs');
const digest = value => 'a'.repeat(64);
const valid = () => ({ schema_version: 1, kind: 'research-evidence-manifest', revision: { id: 'rev', commit: 'abcdef1', sha256: digest() }, datasets: [{ id: 'data', path: 'data.csv', sha256: digest(), status: 'observed' }], code: [{ id: 'code', path: 'train.mjs', sha256: digest(), status: 'observed' }], runs: [{ id: 'run', revision: 'rev', dataset: 'data', code: 'code', status: 'observed' }], assets: [{ id: 'asset', path: 'figure.svg', sha256: digest(), run: 'run', status: 'observed' }], claims: [{ id: 'claim', statement: 'Observed result.', status: 'observed', evidence: ['asset'] }] });

function run(args) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }); }

test('research manifest validates and renders deterministically without promoting observed claims', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-research-'));
  try {
    const input = path.join(dir, 'manifest.json'); const one = path.join(dir, 'one.html'); const two = path.join(dir, 'two.html');
    fs.writeFileSync(input, JSON.stringify(valid()));
    const check = run(['research-manifest', 'validate', input, '--json']);
    assert.equal(check.status, 0); assert.equal(JSON.parse(check.stdout).ok, true);
    for (const output of [one, two]) assert.equal(run(['research-manifest', 'render', input, output, '--json']).status, 0);
    assert.equal(fs.readFileSync(one, 'utf8'), fs.readFileSync(two, 'utf8'));
    const rendered = fs.readFileSync(one, 'utf8');
    for (const target of ['asset-asset', 'run-run', 'dataset-data', 'code-code']) {
      assert.match(rendered, new RegExp(`href="#${target}"`));
      assert.match(rendered, new RegExp(`id="${target}"`));
    }
    assert.match(fs.readFileSync(one, 'utf8'), /data-status="observed"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('research manifest rejects drift and claims without evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-research-'));
  try {
    const input = path.join(dir, 'invalid.json'); const manifest = valid(); manifest.runs[0].revision = 'other'; manifest.claims[0].evidence = [];
    fs.writeFileSync(input, JSON.stringify(manifest)); const result = run(['research-manifest', 'validate', input, '--json']); const receipt = JSON.parse(result.stdout);
    assert.equal(result.status, 1); assert.deepEqual(receipt.diagnostics.map(entry => entry.code), ['research/claim-without-evidence', 'research/revision-drift']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('research manifest rejects malformed collections and planned evidence for supported claims', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-research-'));
  try {
    const input = path.join(dir, 'invalid.json'); const manifest = valid(); manifest.runs = {}; manifest.assets[0].status = 'planned'; manifest.claims[0].status = 'supported';
    fs.writeFileSync(input, JSON.stringify(manifest)); const result = run(['research-manifest', 'validate', input, '--json']); const receipt = JSON.parse(result.stdout);
    assert.equal(result.status, 1); assert.ok(receipt.diagnostics.some(entry => entry.code === 'research/schema')); assert.ok(receipt.diagnostics.some(entry => entry.code === 'research/unsupported-supported-claim'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('research manifest hashes source bytes and protects input paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-research-'));
  try {
    const first = path.join(dir, 'first.json'); const second = path.join(dir, 'second.json'); const text = JSON.stringify(valid()); fs.writeFileSync(first, text); fs.writeFileSync(second, `${text}\n`);
    const one = JSON.parse(run(['research-manifest', 'validate', first, '--json']).stdout); const two = JSON.parse(run(['research-manifest', 'validate', second, '--json']).stdout);
    assert.notEqual(one.inputSha256, two.inputSha256);
    assert.notEqual(run(['research-manifest', 'validate', first, '--jsoon']).status, 0);
    const sameFileRender = run(['research-manifest', 'render', first, first, '--json']);
    assert.equal(sameFileRender.status, 1);
    assert.match(sameFileRender.stderr, /Research manifest output must not replace its input\./);
    assert.equal(fs.readFileSync(first, 'utf8'), text);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
