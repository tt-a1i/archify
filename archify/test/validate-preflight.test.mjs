import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

test('validate --preflight runs browser containment on its temporary checked artifact before delivery', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-validate-preflight-'));
  const missingChrome = path.join(tmp, 'missing-chrome');
  const input = path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json');
  const result = spawnSync(process.execPath, [
    cli,
    'validate',
    'workflow',
    input,
    '--quality', 'showcase',
    '--preflight',
    '--json',
  ], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_CHROME: missingChrome },
  });

  assert.equal(result.status, 2, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.command, 'validate');
  assert.equal(receipt.stage, 'preflight');
  assert.equal(receipt.checker.ok, true, 'deterministic validation must finish before browser preflight');
  assert.equal(receipt.preflight.command, 'visual-preflight');
  assert.equal(receipt.preflight.status, 'skipped');
  assert.equal(receipt.preflight.artifact.ephemeral, true);
  assert.equal(receipt.preflight.sidecars.retained, false);
});
