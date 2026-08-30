import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-cli-'));
const missingChrome = path.join(root, 'missing-chrome');

function run(args, { env = {} } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_CHROME: missingChrome, ...env },
  });
}

function artifact(name) {
  const target = path.join(root, name);
  fs.writeFileSync(target, '<!doctype html><html><body>delivered</body></html>');
  return target;
}

test('visual-check CLI probes Chrome capability without requiring an artifact', () => {
  const result = run(['visual-check', '--probe', '--json']);
  assert.equal(result.status, 2, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.command, 'visual-capability-probe');
  assert.equal(receipt.status, 'unavailable');
  assert.equal(receipt.chrome.executable, null);
});

test('visual-check CLI preflight checks containment without final capture sidecars', () => {
  const input = artifact('preflight.html');
  const result = run(['visual-check', input, '--preflight', '--json']);
  assert.equal(result.status, 2, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.command, 'visual-preflight');
  assert.equal(receipt.status, 'skipped');
  assert.equal(receipt.captures.contactSheet, null);
  assert.equal(fs.existsSync(input.replace(/\.html$/, '.visual-preflight.json')), true);
  assert.equal(fs.existsSync(input.replace(/\.html$/, '.visual-check.html')), false);
});

test('visual-check CLI batches artifacts behind one reusable session receipt', () => {
  const first = artifact('batch-a.html');
  const second = artifact('batch-b.html');
  const result = run(['visual-check', first, second, '--preflight', '--json']);
  assert.equal(result.status, 2, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.command, 'visual-preflight-batch');
  assert.equal(receipt.status, 'skipped');
  assert.equal(receipt.artifacts.length, 2);
  assert.ok(receipt.artifacts.every((entry) => entry.command === 'visual-preflight'));
  assert.equal(fs.existsSync(first.replace(/\.html$/, '.visual-preflight.json')), true);
  assert.equal(fs.existsSync(second.replace(/\.html$/, '.visual-preflight.json')), true);
});

for (const fixture of [
  {
    name: 'missing artifact',
    input: () => path.join(root, 'human-missing.html'),
    error: /ENOENT|no such file/i,
  },
  {
    name: 'non-HTML artifact',
    input: () => {
      const target = path.join(root, 'human-non-html.txt');
      fs.writeFileSync(target, 'not html');
      return target;
    },
    error: /requires an \.html artifact/i,
  },
  {
    name: 'unreadable artifact',
    input: () => {
      const target = path.join(root, 'human-unreadable.html');
      fs.mkdirSync(target, { recursive: true });
      return target;
    },
    error: /EISDIR|illegal operation on a directory|is a directory/i,
  },
]) {
  test(`visual-check CLI preserves the ${fixture.name} failure in human output`, () => {
    const input = fixture.input();
    const result = run(['visual-check', input]);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /visual-check fail:/);
    assert.match(result.stderr, fixture.error);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /TypeError|Cannot read properties|\n\s+at\s/);
  });
}

test('visual-check CLI rejects duplicate resolved artifact paths before batch inspection', () => {
  const input = artifact('batch-duplicate.html');
  const alias = path.join(path.dirname(input), '.', path.basename(input));
  const result = run(['visual-check', input, alias, '--json']);

  assert.equal(result.status, 1, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.command, 'visual-check-batch');
  assert.equal(receipt.status, 'fail');
  assert.equal(receipt.diagnostics[0]?.code, 'viewer/artifact-path-collision');
  assert.equal(fs.existsSync(input.replace(/\.html$/, '.visual-check.json')), false);
});

test('visual-check CLI rejects batch artifacts whose evidence sidecars collide', () => {
  const html = artifact('batch-sidecar-collision.html');
  const htm = artifact('batch-sidecar-collision.htm');
  const result = run(['visual-check', html, htm, '--json']);

  assert.equal(result.status, 1, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.command, 'visual-check-batch');
  assert.equal(receipt.status, 'fail');
  assert.equal(receipt.diagnostics[0]?.code, 'viewer/evidence-path-collision');
  assert.equal(fs.existsSync(html.replace(/\.html$/, '.visual-check.json')), false);
});

test('visual-check CLI applies the evidence collision gate to preflight batches', () => {
  const html = artifact('preflight-sidecar-collision.html');
  const htm = artifact('preflight-sidecar-collision.htm');
  const result = run(['visual-check', html, htm, '--preflight', '--json']);

  assert.equal(result.status, 1, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.command, 'visual-preflight-batch');
  assert.equal(receipt.status, 'fail');
  assert.equal(receipt.diagnostics[0]?.code, 'viewer/evidence-path-collision');
  assert.equal(fs.existsSync(html.replace(/\.html$/, '.visual-preflight.json')), false);
});

test('visual-check CLI preserves a Chrome runtime failure in human output', () => {
  const input = artifact('human-runtime-failure.html');
  const fakeChrome = path.join(root, 'fake-failing-chrome.mjs');
  fs.writeFileSync(fakeChrome, `#!/usr/bin/env node
process.stderr.write('synthetic Chrome runtime failure\\n');
process.exit(23);
`);
  fs.chmodSync(fakeChrome, 0o755);

  const result = run(['visual-check', input], { env: { ARCHIFY_CHROME: fakeChrome } });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /visual-check fail:/);
  assert.match(result.stderr, /synthetic Chrome runtime failure/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /TypeError|Cannot read properties|\n\s+at\s/);
});

test('visual-check CLI preserves per-artifact failures in batch human output', () => {
  const missing = path.join(root, 'human-batch-missing.html');
  const valid = artifact('human-batch-valid.html');
  const result = run(['visual-check', missing, valid]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /visual-check-batch fail: 2 artifacts/);
  assert.match(result.stderr, /ENOENT|no such file/i);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /TypeError|Cannot read properties|\n\s+at\s/);
});
