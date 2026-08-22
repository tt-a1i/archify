import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-base-input-compatibility-'));

function renderBaseFixture(type, name) {
  const input = path.join(skillRoot, 'test', 'fixtures', 'v1-baseline', name);
  const output = path.join(tmp, `${name}.html`);
  return spawnSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    'render',
    type,
    input,
    output,
  ], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

test('base named-route fixtures remain valid without redundant authored endpoint sides', () => {
  for (const [type, name] of [
    ['dataflow', 'event-stream.dataflow.json'],
    ['architecture', 'production-deployment.architecture.json'],
  ]) {
    const result = renderBaseFixture(type, name);
    assert.equal(
      result.status,
      0,
      `${type} base input must remain valid:\n${result.stdout || result.stderr}`,
    );
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
