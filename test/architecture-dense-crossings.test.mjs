import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { denseArchitecture } from './helpers/dense-architecture.mjs';

const renderer = fileURLToPath(new URL('../archify/renderers/architecture/render-architecture.mjs', import.meta.url));
const checker = fileURLToPath(new URL('../archify/scripts/check-render-output.mjs', import.meta.url));

function run(script, ...args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? (result.stderr || result.stdout));
  return result.stdout;
}

// Crossing counts measured by the SVG checker on Round 24 (0e6eb0a95).
// Retain a ceiling so any other valid improvement can pass these properties.
const cases = [
  { cards: 9, seed: 13, previous: 1 },
  { cards: 9, seed: 107, previous: 1, improved: true },
  { cards: 10, seed: 13, previous: 1 },
  { cards: 10, seed: 107, previous: 0 },
  { cards: 11, seed: 13, previous: 1 },
  { cards: 11, seed: 107, previous: 1 },
  { cards: 12, seed: 13, previous: 0 },
  { cards: 12, seed: 107, previous: 1 },
];

for (const { cards, seed, previous, improved } of cases) {
  test(`automatic layout with ${cards} cards (seed ${seed}) keeps or reduces rendered crossings`, t => {
    const directory = mkdtempSync(join(tmpdir(), 'archify-dense-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const input = join(directory, 'input.json');
    const output = join(directory, 'chart.html');
    writeFileSync(input, JSON.stringify(denseArchitecture(seed, cards)));
    run(renderer, input, output);
    const { composition: { metrics } } = JSON.parse(run(checker, output, '--json'));
    const crossings = metrics.resolvedCrossovers + metrics.properCrossings;
    assert.ok(crossings <= previous, `previously ${previous} crossings, now ${crossings}`);
    if (improved) assert.ok(crossings < previous, 'a misplaced shared store should no longer cross the other route');

    const first = readFileSync(output, 'utf8');
    run(renderer, input, output);
    assert.equal(readFileSync(output, 'utf8'), first);
  });
}
