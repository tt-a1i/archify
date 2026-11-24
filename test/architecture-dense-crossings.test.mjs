import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compositionImbalance } from '../archify/renderers/architecture/automatic-placement-candidates.mjs';
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

test('two independent terminal crossings are removed in a 14-card layout', t => {
  // One pair crosses at the shared reporting sink and the other at the record store.
  const { metrics } = renderDense(t, denseArchitecture(7, 14)).check();
  assert.equal(metrics.resolvedCrossovers + metrics.properCrossings, 0);
});

test('an uncrossed side leaf moves out of the skip-link corridor', t => {
  const diagram = renderDense(t, denseArchitecture(5, 12));
  const { metrics } = diagram.check();
  const layout = diagram.layout();
  // The skip link card-2 -> card-7 crosses the branch card-3 -> card-11
  // while the uncrossed leaf card-8 occupies a lane beside card-5.
  assert.equal(metrics.resolvedCrossovers + metrics.properCrossings, 0);
  const intermediate = layout.components.find(({ id }) => id === 'card-5');
  const leaf = layout.components.find(({ id }) => id === 'card-8');
  assert.ok(leaf.y >= intermediate.y + intermediate.height, 'the leaf clears the route beside the intermediate card');
});

test('a nine-card fan-out keeps the entry above the bottom band and fills the leading region', t => {
  const cards = [
    ['client', 135], ['entry', 156], ['collect', 120], ['search', 120], ['update', 128],
    ['samples', 120], ['files', 156], ['index', 142], ['history', 135],
  ];
  const links = [
    ['client', 'entry', 'Start request', 'emphasis'],
    ['entry', 'collect', 'Scan'],
    ['entry', 'search', 'Find records'],
    ['entry', 'update', 'Prepare and confirm'],
    ['collect', 'samples', 'Sample data'],
    ['collect', 'files', 'Read files'],
    ['collect', 'index', 'Commit records and index'],
    ['search', 'index', 'Find and save results'],
    ['search', 'files', 'Verify and read files'],
    ['update', 'index', 'Read and write receipts'],
    ['update', 'files', 'Apply verified changes'],
    ['update', 'history', 'Write audit records'],
  ];
  const spec = {
    schema_version: 1,
    diagram_type: 'architecture',
    layout: { mode: 'auto' },
    meta: { title: 'Record management', output: 'chart.html', quality_profile: 'showcase' },
    components: cards.map(([id, width]) => ({ id, label: id, type: 'backend', size: [width, 60] })),
    connections: links.map(([from, to, label, variant]) => ({ from, to, label, variant })),
  };
  const layout = renderDense(t, spec).layout();
  const boxes = new Map(layout.components.map(card => [card.id, { ...card, cy: card.y + card.height / 2 }]));
  const scene = { boxes, routes: spec.connections.map(relation => ({ relation })),
    titles: { boundaries: [] }, viewBox: layout.viewBox };
  assert.deepEqual(compositionImbalance(scene), { leadingVoid: 0, sunkenRoots: 0, score: 0 });
  assert.equal(boxes.get('collect').y, boxes.get('samples').y);
  assert.equal(boxes.get('update').y, boxes.get('history').y);
});

function renderDense(t, spec) {
  const directory = mkdtempSync(join(tmpdir(), 'archify-dense-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'input.json');
  const output = join(directory, 'chart.html');
  writeFileSync(input, JSON.stringify(spec));
  return {
    check() {
      run(renderer, input, output);
      return JSON.parse(run(checker, output, '--json')).composition;
    },
    layout: () => JSON.parse(run(renderer, input, '--layout-json')),
  };
}
