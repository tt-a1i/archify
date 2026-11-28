// Packaging contract for the shipped skill: an example that declares
// `meta.quality_profile: "showcase"` must survive the same gate an authoring
// agent is told to run. Without this guard the package drifts away from its own
// contract (see #1465), because `deliver` alone only reports the composition
// warnings that `finalize --quality showcase` escalates into a failure.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const examplesRoot = path.join(skillRoot, 'examples');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-showcase-'));
const run = promisify(execFile);

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function showcaseExamples() {
  return fs.readdirSync(examplesRoot)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry) => {
      const spec = JSON.parse(fs.readFileSync(path.join(examplesRoot, entry), 'utf8'));
      if (spec.meta?.quality_profile !== 'showcase') return [];
      // `cache-miss-request.sequence.json` -> sequence; the type is the last segment.
      const type = entry.replace(/\.json$/, '').split('.').pop();
      return [{ entry, type }];
    });
}

async function finalize(example) {
  const output = path.join(tmp, `${example.entry}.html`);
  try {
    await run(process.execPath, [
      cli, 'finalize', example.type,
      path.join(examplesRoot, example.entry),
      output, '--quality', 'showcase', '--json',
    ], { cwd: skillRoot, encoding: 'utf8' });
    return null;
  } catch (error) {
    const stdout = error.stdout || '';
    let report = null;
    try { report = JSON.parse(stdout); } catch { /* fall back to the exit status */ }
    const codes = (report?.diagnostics || [])
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.code);
    return `${example.entry} (${example.type})${codes.length ? `: ${codes.join(', ')}` : `: exited ${error.code}`}`;
  }
}

test('every shipped showcase example passes finalize --quality showcase', async () => {
  const examples = showcaseExamples();
  assert.ok(examples.length > 0, 'expected the skill to ship showcase examples');

  // `finalize` publishes delivery evidence under a repo-level lock, so two runs
  // in flight abort with `delivery/concurrent-attempt`; the sweep stays serial.
  const failures = [];
  for (const example of examples) {
    const failure = await finalize(example);
    if (failure) failures.push(failure);
  }
  assert.deepEqual(
    failures, [],
    `showcase examples must pass the gate they declare — either fix the spec or downgrade meta.quality_profile:\n  ${failures.join('\n  ')}`,
  );
});
