import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

test('passing validate emits a frozen candidate and one hash-bound finalize action', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-next-action-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'diagram.json');
  const source = fs.readFileSync(path.join(skillRoot, 'examples', 'web-app.architecture.json'));
  fs.writeFileSync(input, source);
  const sha256 = createHash('sha256').update(source).digest('hex');

  const result = spawnSync(process.execPath, [
    cli, 'validate', 'architecture', input,
    '--repo-root', directory,
    '--quality', 'showcase',
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.candidateFrozen, true);
  assert.deepEqual(receipt.candidate, { path: input, sha256, bytes: source.byteLength });
  assert.equal(receipt.nextAction.command, 'finalize');
  assert.deepEqual(receipt.nextAction.arguments, [
    'architecture', input, '<output.html>',
    '--quality', 'showcase',
    '--repo-root', directory,
    '--candidate-sha256', sha256,
    '--json',
  ]);
});

test('finalize fails closed before gates when the validated candidate hash changed', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-next-action-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  fs.copyFileSync(path.join(skillRoot, 'examples', 'web-app.architecture.json'), input);

  const result = spawnSync(process.execPath, [
    cli, 'finalize', 'architecture', input, output,
    '--candidate-sha256', '0'.repeat(64),
    '--quality', 'showcase',
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(fs.existsSync(output), false);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.gates.validate, 'not-run');
  assert.equal(receipt.diagnostics[0].code, 'finalize/candidate-changed');
  assert.equal(receipt.diagnostics[0].evidence.expectedSha256, '0'.repeat(64));
});
