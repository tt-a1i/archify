import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');

test('lifecycle renders no arrow without a semantic source and target', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-lifecycle-arrow-'));
  const input = path.join(skillRoot, 'examples', 'agent-run.lifecycle.json');
  const output = path.join(tmp, 'agent-run.lifecycle.html');

  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers', 'lifecycle', 'render-lifecycle.mjs'),
    input,
    output,
  ]);

  const html = fs.readFileSync(output, 'utf8');
  const arrows = [...html.matchAll(/<path\b[^>]*\bmarker-end="[^"]+"[^>]*>/g)].map((match) => match[0]);
  const anonymousArrows = arrows.filter((arrow) => (
    !arrow.includes('data-edge-from=') || !arrow.includes('data-edge-to=')
  ));

  assert.ok(arrows.length > 0, 'fixture must render relationship arrows');
  assert.deepEqual(
    anonymousArrows,
    [],
    'an arrow without semantic endpoints can appear as an unexplained line when node focus dims its masks',
  );
});
